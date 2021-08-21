const fs = require("fs");
const path = require("path");
const axios = require("axios");

const config = {
    frame: 'react', // react, angular
    input: "./test.js",  // 要国际化的文件夹（或文件）的相对路径（或绝对路径,eg: /Users/admin/ecs-console-v4/src/pages/Snapshot）
    prefix: 'ecs.',  // 国际化文案的key的前缀（有个点）
    output: "./zh.js",  // 生成的国际化文案输出到文件的路径
}


const concatReg = (flag, ...regs) => {
    const concatRegStr = new RegExp(regs.reduce((all, r) => all+r, '')).toString()
        .replace(/\\\//g, '')
        .replace(/\//g, '')
    return new RegExp(concatRegStr, flag)
}

const zh = /[\u4E00-\u9FA5\uFE30-\uFFA0]+/
const first = /([\u4E00-\u9FA5\uFE30-\uFFA00-9a-zA-Z]+\s+)*/
const left = /[\u4E00-\u9FA5\uFE30-\uFFA00-9a-zA-Z]*/
const right = /[\u4E00-\u9FA5\uFE30-\uFFA00-9a-zA-Z ]*/
const baseReg = concatReg(undefined, first, left, zh, right); // 必须有中文，可以包含数字和英文，不能为空格开头
console.log(baseReg)
const reg = concatReg('g', baseReg)

const parseFileZh = (fileName) => {
    const fileData = fs.readFileSync(fileName);
    const contentStr = fileData.toString("utf8");

    const strReg = concatReg('g',/('|")/, baseReg, /('|")/) // '单双引号中的中文'
    const leftTagZhReg = concatReg('g',/>\s*/, baseReg) // >左标签
    const rightTagZhReg = concatReg('g',baseReg, /\s*</) // 右标签<

    const strArr = contentStr.match(strReg) || [];
    const leftTagStrArr = contentStr.match(leftTagZhReg) || [];
    const rightTagStrArr = contentStr.match(rightTagZhReg) || [];

    const zhArr = Array.from(new Set([...strArr, ...leftTagStrArr, ...rightTagStrArr])).map(str => str.match(reg).toString());
    const zhMap = zhArr.reduce((all, zh) => ({ ...all, [zh]: "" }), {});
    return zhMap;
};

const paserDir = (dirPath, fileCallback) => {
    if(fs.statSync(dirPath).isFile()){
        fileCallback(dirPath)
        return
    }

    const childrenDir = fs.readdirSync(dirPath);
    childrenDir.forEach(childPath => {
        const filePath = path.join(dirPath, childPath);
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
            fileCallback(filePath);
        }
        if (stats.isDirectory()) {
            paserDir(filePath, fileCallback);
        }
    });
};

const translateRequest = (key) => {
    return new Promise((resolve, reject) => {
        axios.get(encodeURI(`https://fanyi.youdao.com/translate?&doctype=json&type=AUTO&i=${key}`)).then(res => {
            const en = res.data.translateResult[0][0].tgt
            resolve([[key], en]);
        }).catch(("error", err => {
            reject(err);
        }));
    }).catch(err => console.dir('翻译出错，请再次尝试，如果多次都翻译失败，可能是该文件夹下文案太多，多并发调用api导致失败，可以按文件夹分批次来执行', err));
};

const translateZh = async (zhMap, prefix) => {
    const needTranslate = Object.keys(zhMap).filter(k => !zhMap[k]);
    console.log(`正在翻译中文。。。`)
    const allEn = await Promise.all(needTranslate.map(key => translateRequest(key)));
    await allEn.forEach(([key, en]) => {
        const enKey = prefix + (
            en.replace(/\s+/g, ".")
                .replace(/((?![a-zA-Z0-9.]+).)*/g, "") // 只保留字母数字和.
                .toLowerCase()
        );
        zhMap[key] = enKey;

    });
};

const replaceZhToEnInReact = (filePath, zhMap) => {
    fs.readFile(filePath, function(err, data) {
        const strZhReg = concatReg(undefined,/('|")/, baseReg, /('|")/) // '单双引号中的中文'

        const intledZhReg =  concatReg('g',/intl\(\s*/, strZhReg, /\s*\)/); // intl('intl方法中的中文')
        const tagAttrStrZhReg = concatReg('g',/=/, strZhReg); // ="标签属性的中文"
        const strZhRegWithG = concatReg('g', strZhReg); // '单双引号中的中文'/g
        const leftTagZhReg = concatReg('g',/>\s*/, baseReg) // >左标签
        const rightTagZhReg = concatReg('g',baseReg, /\s*</) // 右标签<

        let content = data.toString("utf8")
            .replace(intledZhReg, ch => ch.replace(reg, z => zhMap[z]))
            .replace(tagAttrStrZhReg, ch => `={intl('${zhMap[ch.match(reg)]}')}`)
            .replace(strZhRegWithG, ch => `intl('${zhMap[ch.match(reg)]}')`)
            .replace(leftTagZhReg, ch => ch.replace(reg, z => `{intl('${zhMap[z]}')}`))
            .replace(rightTagZhReg, ch => ch.replace(reg, z => `{intl('${zhMap[z]}')}`));

        if(content !== data.toString("utf8")) {
            if (!data.toString("utf8").includes('intl')) {
                content = `import { intl } from '@alicloud/console-components-intl-core';
` + content;
            }
            console.log(`正在将---- ${filePath} ---文件中的中文替换为key`)
            fs.writeFileSync(filePath, content);
        }
    });
}

const replaceZhToEnInAngular = (filePath, zhMap) => {
    fs.readFile(filePath, function(err, data) {
        const strZhReg = concatReg(undefined,/('|")/, baseReg, /('|")/) // '单双引号中的中文'

        const strZhRegWithG = concatReg('g', strZhReg); // '单双引号中的中文'/g

        let content = ''
        if(filePath.endsWith('.html')){
            const tagAttrStrZhReg = concatReg('g',/\s+[a-zA-Z\.]+=/, strZhReg); // ="标签属性的中文"
            const translatedStrZhReg = concatReg('g',strZhReg, /\s*\|\s*translate/); // "translate的中文" ｜ translate
            const leftTagZhReg = concatReg('g',/>\s*/, baseReg) // >左标签
            const rightTagZhReg = concatReg('g',baseReg, /\s*</) // 右标签<

            content = data.toString("utf8")
                .replace(tagAttrStrZhReg, ch => ch.replace(reg, z => `'${zhMap[z]}' | translate`)
                    .replace(/\s+[a-zA-Z\.]+=/, attr => attr.replace(/[a-zA-Z\.]+/, z => `[${z}]`)))
                .replace(translatedStrZhReg, ch => ch.replace(reg, z => zhMap[z]))
                .replace(strZhRegWithG, ch => `('${zhMap[ch.match(reg)]}' | translate)`) // 增加括号，防止在表达式中语法错误
                .replace(leftTagZhReg, ch => ch.replace(reg, z => `{{'${zhMap[z]}' | translate}}`))
                .replace(rightTagZhReg, ch => ch.replace(reg, z => `{{'${zhMap[z]}' | translate}}`));
        }
        else if (filePath.endsWith('.spec.ts')) {return}
        else if (filePath.endsWith('.ts')) {
            const i18nZhReg =  concatReg('g',/i18n\(\s*/, strZhReg, /\s*\)/); // i18n('i18n方法中的中文')
            content = data.toString("utf8")
                .replace(i18nZhReg, ch => ch.replace(reg, z => zhMap[z]))
                .replace(strZhRegWithG, ch => `i18n('${zhMap[ch.match(reg)]}')`)

        }
        else {
            return;
        }

        if(content !== data.toString("utf8")) {
            if (filePath.endsWith('.ts') && !data.toString("utf8").includes('i18n')) {
                content = `import { i18n } from "@ali/ng-console-blocks-new";
` + content;
            }
            console.log(`正在将---- ${filePath} ---文件中的中文替换为key`)
            fs.writeFileSync(filePath, content);
        }
    });
};

const outputIntlFile = (outputPath, zhMap) => {
    const intlMap = Object.fromEntries(Object.entries(zhMap).map(([k, v]) => ([v, k])));
    const content = "export default " + JSON.stringify(intlMap, "", 2) + ";";
    fs.writeFileSync(outputPath, content);
    console.log(`已找到 ${Object.entries(zhMap).length} 条中文文案并全部输出到  ${outputPath}  文件中`)
};

const translate = async ({frame, input, prefix, output}) => {
    const allZh = {};
    console.log(`正在提取中文。。。`)
    await paserDir(input, filePath => {
        Object.assign(allZh, parseFileZh(filePath));
    });
    if(!Object.keys(allZh).length){
        console.log(`${input}文件中没有找到中文文案`)
        return;
    }
    await translateZh(allZh, prefix);
    await paserDir(input, filePath => {
        frame === 'react' ? replaceZhToEnInReact(filePath, allZh) : replaceZhToEnInAngular(filePath, allZh)
    });
    await outputIntlFile(output, allZh);
};

translate(config)