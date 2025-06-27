#!/usr/bin/env node

import os from 'os';
import { readFile } from 'node:fs/promises';
import readline from 'readline';

let gamefile = null;
let autorestore = false;
let autosavedir = '.';

// Super-cheap arg parsing.

let args = process.argv.slice(2);
while (args.length) {
    let arg = args.shift();
    if (arg == '--autorestore') {
        autorestore = true;
        continue;
    }
    if (arg == '--autodir') {
        autosavedir = args.shift();
        continue;
    }
    if (arg.startsWith('--')) {
        console.log('unrecognized argument:', arg);
        process.exit();
    }
    gamefile = arg;
}

let story = null;
let newstylesave = null;

try {
    let dat = await readFile(gamefile, { encoding: 'utf8' });

    /* First we strip the BOM, if there is one. Dunno why JSON.parse
       can't deal with a BOM, but okay. */
    dat = dat.replace(/^\uFEFF/, '');
    
    let json = JSON.parse(dat);
    let version = parseInt(json["inkVersion"]);
    if (version >= 18) {
        let InkJS = await import('./inkjs/ink.min.js');
        story = new InkJS.default.Story(json);
        newstylesave = true;
    }
    else if (version >= 16) {
        let InkJS = await import('./inkjs/ink-160.min.js');
        story = new InkJS.default.Story(json);
        newstylesave = false;
    }
    else if (version >= 15) {
        let InkJS = await import('./inkjs/ink-146.min.js');
        story = new InkJS.default.Story(json);
        newstylesave = false;
    }
    else {
        let InkJS = await import('./inkjs/ink-130.min.js');
        story = new InkJS.default.Story(json);
        newstylesave = false;
    }
} catch (err) {
    console.error(err.message);
    process.exit();
}

async function read_stanza(reader)
{
    let buf = '';

    //### check that the first character is open brace
    for await (let ln of reader) {
        buf += ln;
        buf += '\n';
        try {
            let obj = JSON.parse(buf);
            return obj;
        }
        catch (err) { }
    }

    throw new Error('stream ended without valid JSON');
}

let gen = 0;

let input = null;

try {
    let reader = readline.createInterface({ input: process.stdin, terminal: false });
    input = await read_stanza(reader);
    reader.close();
} catch (err) {
    console.error(err.message);
    process.exit();
}
console.log('### input', input);

try {
    while (story.canContinue) {
        var text = story.Continue();
        console.log(text);
    }
}
catch (err) {
    console.error(err.message);
    process.exit();
}
