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

    for await (let ln of reader) {
        buf += ln;
        buf += '\n';

        let val = buf.trim();
        if (val.length && !val.startsWith('{')) 
            throw new Error('stream did not begin with an open brace');
        
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
    if (!context.metrics) {
        if (!input.metrics)
            throw new Error('first input had no metrics');
        context.metrics = input.metrics;
        context.newturn = true;
    }
    else {
        if (!(input.type == 'hyperlink' && input.window == 1))
            return;
        let ls = input.value.split(':');
        if (ls.length != 2)
            return;
        let turn = parseInt(ls[0]);
        let index = parseInt(ls[1]);
        if (turn == context.game_turn && index >= 0 && index < story.currentChoices.length) {
            //### stash the choice text
            story.ChooseChoiceIndex(index);
            context.newturn = true;
        }
        //### should re-input, really
    }
}

function generate_output(story)
{
    let outlines = [];
    let output = {
        type: 'update',
        gen: context.gen,
    }

    if (!context.newturn)
        return output;
    
    if (context.gen <= 1) {
        output.windows = [
            { id: 1, type: "buffer", rock: 0,
              left: 0, top: 0, width: 800, height: 480 }
        ];
    }
    
    output.content = [
        { id: 1, text: outlines },
    ];

    while (story.canContinue) {
        let text = story.Continue();
        for (let val of text.split('\n')) {
            if (val == '') {
                outlines.push({});
                continue;
            }
            let dat = {
                content: [ { style: "normal", text: val } ]
            };
            outlines.push(dat);
        }
    }

    if (story.currentChoices.length == 0) {
        output.exit = true;
    }
    else {
        for (let ix=0; ix<story.currentChoices.length; ix++) {
            let choice = story.currentChoices[ix].text;
            let link = context.game_turn+':'+ix;
            let dat = {
                content: [
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

    context.metrics = snapshot.metrics;
    context.game_turn = snapshot.turn;
    context.gen = snapshot.gen;
}

async function do_autosave(story)
{
    let filename = path.join(autosavedir, 'autosave.json');

    let saveval = undefined;
    if (newstylesave)
        saveval = story.state.ToJson();
    else
        saveval = story.state.jsonToken;

    let snapshot = {
        ink: saveval,
        turn: context.game_turn,
        gen: context.gen,
    };
    
    if (context.metrics) {
        snapshot.metrics = { width: context.metrics.width, height: context.metrics.height };
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

let context = {
    // GlkOte generation number.
    gen: 0,
    
    // GlkOte metrics. (We only care about width and height, because
    // we will only have one window.)
    metrics: null,
    
    // We need to distinguish each turn's hyperlinks.
    game_turn: 0,

    // Does this input advance the game_turn?
    newturn: false,
};

let input = null;

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
        await do_autorestore(story);
    }
    catch (err) {
        console.error(err.message);
        process.exit();
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
    context.gen++;
    if (context.newturn)
        context.game_turn++;
    output = generate_output(story);
}
catch (err) {
    console.error(err.message);
    process.exit();
}

await do_autosave(story);

console.log(JSON.stringify(output));
