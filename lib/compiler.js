const fs = require('fs')
const ejs = require('ejs')
const path = require('path')
// const template = fs.readFileSync(path.join(__dirname, '../src/template.ejs'), { encoding: 'utf8' })

// const parseCode = (realPath, basePath, modules) => {
//     const { dir } = path.parse(basePath)

//     let sourceCode = fs.readFileSync(realPath, { encoding: 'utf8' })
//     const dependencePaths = sourceCode.match(/(?<=require\(').+(?='\))/g)
//     console.log(sourceCode)

//     // const realCode = `${sourceCode.replace(/require/, '__webpack_require__')}`
//     if (dependencePaths) {
//         dependencePaths.forEach(pathItem => {
//             const dirPath = `./${path.join(dir, pathItem)}`
//             const realPath = path.resolve(dir, pathItem)
//             parseCode(realPath, dirPath, modules)
//             sourceCode.replace(`require('${pathItem}')`, `__webpack_require__('${dirPath}')`)
//         })
//     }

//     modules[basePath] = sourceCode
// }

// const output = (config, data) => {
//     const { output } = config
//     const code = ejs.render(template, data)
//     fs.writeFileSync(path.join(output.path, output.filename), code, { encoding: 'utf8' })
// }

// const compiler = (config) => {
//     const modules = {}
//     const { entry } = config
//     const entryRealPath = path.resolve(process.cwd(), entry)

//     parseCode(entryRealPath, entry, modules)

//     output(config, { entry: entry, modules })
// }

// module.exports = {
//     compiler,
// }
const babylon = require('babylon')
const { SyncHook } = require('tapable')
const traverse = require('@babel/traverse').default
const types = require('@babel/types')
const generator = require('@babel/generator').default

class Compiler {
    constructor (config) {
        this.config = config
        // 保存入口文件的路径
        this.entryId
        // 所有的依赖模块
        this.modules = {}
        // 入口路径
        this.entry = config.entry
        // 工作路径
        this.root = process.cwd()
        // 注册插件
        this.hooks = {
            run: new SyncHook(['name']),
            startCompile: new SyncHook(['name']),
            endCompile: new SyncHook(['name']),
            emitFile: new SyncHook(['name']),
        }

        const { plugins } = this.config
        plugins.forEach(plugin => {
            plugin.apply(this)
        })
    }

    getSource (modulePath) {
        let content = fs.readFileSync(modulePath, 'utf-8')
        const rules = this.config.module.rules
        rules.forEach(rule => {
            const { test } = rule
            if (test.test(modulePath)) {
                const { use } = rule
                let len = use.length - 1
                const transformLoader = function () {
                    if (len < 0) return
                    const curUse = require(use[len--])
                    content = curUse(content)
                    transformLoader()
                }
                transformLoader()
            }
        })
        return content
    }

    // babylon 将源码转换为ast
    // @babel/traverse 遍历节点
    // @babel/types 替换节点
    // @babel/generator ast转换为源码
    parse (source, parentPath) {
        const ast = babylon.parse(source)
        let dependencies = [] // 存放依赖数组
        traverse(ast, {
            CallExpression (p) {
                let node = p.node
                if (node.callee.name === 'require') {
                    node.callee.name = '__webpack_require__'
                    let moduleName = node.arguments[0].value
                    moduleName = moduleName + (path.extname(moduleName) ? '' : '.js')
                    moduleName = './' + path.join(parentPath, moduleName) // ./src/a.js
                    dependencies.push(moduleName)
                    node.arguments = [types.stringLiteral(moduleName)]
                }
            },
            VariableDeclaration (p) {
                let node = p.node
                node.kind = 'var'
            }
        })
        const sourceCode = generator(ast).code
        return { sourceCode, dependencies }
    }

    buildModule (modulePath, isEntry) {
        // 拿到模块的内容
        let source = this.getSource(modulePath)

        let moduleName = './' + path.relative(this.root, modulePath)

        // 如果是入口, 将moduleName赋值给根入口moduleId
        if (isEntry) {
            this.entryId = moduleName
        }
        // 解析需要将source改造, 返回改造后code 和 依赖列表
        let { sourceCode, dependencies } = this.parse(source, path.dirname(moduleName))

        this.modules[moduleName] = sourceCode

        if (dependencies.length) { // 递归解析依赖模块
            dependencies.forEach(dep => {
                this.buildModule(path.join(this.root, dep), false)
            })
        }
    }

    emitFile () {
        // 根据ejs模版渲染js
        const mainPath = path.join(this.config.output.path, this.config.output.filename)
        const templateStr = this.getSource(path.resolve(__dirname, '../src/template.ejs'))
        const code = ejs.render(templateStr, { entryId: this.entryId, modules: this.modules })

        // 存放打包多个文件代码
        this.assets = {}
        this.assets[mainPath] = code
        fs.writeFileSync(mainPath, code)
        this.hooks.emitFile.call('emitFile')
    }
    run () {
        this.hooks.run.call('run')
        // 执行 并且创建模块的依赖关系
        this.hooks.startCompile.call('startCompile')
        this.buildModule(path.resolve(this.root, this.entry), true)
        this.hooks.endCompile.call('endCompile')
        // 发射打包后的文件
        this.emitFile()
    }
}

module.exports = Compiler