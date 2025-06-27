#!/usr/bin/env node

import os from 'os';
import path from 'path';
import { readFile, writeFile, access } from 'node:fs/promises';
import readline from 'readline';

let gamefile = null;
let autorestore = false;
let autosavedir = '.';

// Filthy trick to suppress warnings inside the inkjs library.
console.warn = (arg) => {};

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

async function read_gamefile(gamefile)
{
    let dat = await readFile(gamefile, { encoding: 'utf8' });

    /* First we strip the BOM, if there is one. Dunno why JSON.parse
       can't deal with a BOM, but okay. */
    dat = dat.replace(/^\uFEFF/, '');
    
    let story = null;
    let newstylesave = null;

    let json = JSON.parse(dat);
    if (!json["inkVersion"]) {
        throw new Error('does not appear to be an ink.json file');
    }
    
    let version = parseInt(json["inkVersion"]);
    if (Number.isNaN(version)) {
        throw new Error('ink.json version is not a number');
    }
    
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

    return { story, newstylesave };
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

function handle_input(input)
{
    if (true) {
        if (!input.metrics)
            throw new Error('first input had no metrics');
        metrics = input.metrics;
    }
    else {
        //###
    }
}

function generate_output(story, game_turn)
{
    let outlines = [];
    let output = {
        type: 'update',
        gen: gen,
        //### omit windows after startup
        //### catch and hold metrics
        windows: [
            { id: 1, type: "buffer", rock: 0,
              left: 0, top: 0, width: 800, height: 480 }
        ],
        content: [
            { id: 1, text: outlines },
        ],
    };

    while (story.canContinue) {
        let text = story.Continue();
        let dat = {
            content: [ { style: "normal", text: text} ]
        };
        outlines.push(dat);
    }

    if (story.currentChoices.length == 0) {
        output.exit = true;
    }
    else {
        for (let ix=0; ix<story.currentChoices.length; ix++) {
            let choice = story.currentChoices[ix].text;
            let link = game_turn+':'+ix;
            let dat = {
                content: [
                    { style: "note", text: ix+': ' },
                    { style: "note", text: choice, hyperlink: link }
                ]
            };
            outlines.push(dat);
        }
        output.input = [ { id: 1, gen: 0, hyperlink: true } ];
    }

    return output;
}

async function do_autorestore(story)
{
    let filename = path.join(autosavedir, 'autosave.json');

    try {
        await access(filename);
    }
    catch {
        return null;
    }

    let dat = await readFile(filename, { encoding: 'utf8' });
    let snapshot = JSON.parse(dat);

    if (newstylesave)
        story.state.LoadJson(snapshot.ink);
    else
        story.state.jsonToken = snapshot.ink;
    
    return { game_turn: snapshot.turn, gen: snapshot.gen, metrics: snapshot.metrics };
}

async function do_autosave(story, game_turn)
{
    let filename = path.join(autosavedir, 'autosave.json');

    let saveval = undefined;
    if (newstylesave)
        saveval = story.state.ToJson();
    else
        saveval = story.state.jsonToken;

    let snapshot = {
        ink: saveval,
        turn: game_turn,
        gen: gen,
    };
    
    if (metrics) {
        snapshot.metrics = { width: metrics.width, height: metrics.height };
    }

    let json = JSON.stringify(snapshot)+'\n';

    await writeFile(filename, json, { encoding: 'utf8' });
}

let story = null;
let newstylesave = null;

try {
    ({ story, newstylesave } = await read_gamefile(gamefile));
} catch (err) {
    console.error(err.message);
    process.exit();
}

let gen = 0;
let metrics = null;
let input = null;

/* We need to distinguish each turn's hyperlinks. */
let game_turn = 0;

try {
    let reader = readline.createInterface({ input: process.stdin, terminal: false });
    input = await read_stanza(reader);
    reader.close();
} catch (err) {
    console.error(err.message);
    process.exit();
}

if (autorestore) {
    let obj = null;
    try {
        obj = await do_autorestore(story);
    }
    catch (err) {
        console.error(err.message);
        process.exit();
    }
    if (obj) {
        ({ game_turn, gen, metrics } = obj);
    }
}

try {
    handle_input(input);
} catch (err) {
    console.error(err.message);
    process.exit();
}

let output = null;

try {
    game_turn++;
    output = generate_output(story, game_turn);
}
catch (err) {
    console.error(err.message);
    process.exit();
}

await do_autosave(story, game_turn);

console.log(JSON.stringify(output));
