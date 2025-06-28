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

// Read the game file (.ink.json); load the appropriate version of the
// inkjs library; create the Story.
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

// Read one JSON stanza from the readline object (which is wrapped around
// stdin). As usual, we assume that the stanza ends with a newline, but
// newlines *within* the stanza are okay.
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

// Accept a GlkOte input object. If it's a hyperlink event,
// advance the story.
function handle_input(input)
{
    if (!context.metrics) {
        if (!input.metrics)
            throw new Error('first input had no metrics');
        context.metrics = input.metrics;
        context.newinput = true;
        context.newturn = true;
    }
    else {
        if (!(input.type == 'hyperlink' && input.window == 1))
            return;
        context.newinput = true;
        
        let ls = input.value.split(':');
        if (ls.length != 2)
            return;
        let turn = parseInt(ls[0]);
        let index = parseInt(ls[1]);
        if (turn == context.game_turn && index >= 0 && index < story.currentChoices.length) {
            context.choicetext = story.currentChoices[index].text;
            context.newturn = true;
            story.ChooseChoiceIndex(index);
        }
    }
}

// Generate a GlkOut output object.
function generate_output(story)
{
    let outlines = [];
    let output = {
        type: 'update',
        gen: context.gen,
    }

    if (context.gen <= 1) {
        output.windows = [
            { id: 1, type: "buffer", rock: 0,
              left: 0, top: 0, width: 800, height: 480 }
        ];
    }
        
    if (context.newturn) {
        if (context.choicetext) {
            let dat = {
                content: [ { style: "input", text: context.choicetext } ]
            };
            outlines.push(dat);
            outlines.push({});
        }
        
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
        }
    }

    if (context.newinput) {
        if (story.currentChoices.length > 0) {
            output.input = [ { id: 1, gen: 0, hyperlink: true } ];
        }
    }

    if (outlines.length) {
        output.content = [
            { id: 1, text: outlines },
        ];
    }
    
    return output;
}

// Attempt to restore from a state file. If there is none, silently leave
// the story in its initial state.
async function do_autorestore(story)
{
    let filename = path.join(autosavedir, 'autosave.json');

    try {
        await access(filename);
    }
    catch {
        return;
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

// Save to state file.
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

// Let's get to work!

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

    // Text to repeat at the beginning of the output.
    choicetext: null,

    // Does this input complete hyperlink input?
    newinput: false,

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
