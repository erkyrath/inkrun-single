# inkrun-single -- a single-turn GlkOte wrapper for the InkJS interpreter

This is a Node script which starts an Ink game, executes one turn, and exits. The input and output are JSON stanzas in the [GlkOte][] format.

The Ink execution itself is handled by the [InkJS][] interpreter. The built version of InkJS is included in this repository. (Actually several versions, to support older Ink game formats.)

This script is meant to be used with the [Discoggin][] Discord bot.

[InkJS]: https://github.com/y-lohse/inkjs
[Discoggin]: https://github.com/iftechfoundation/discoggin
[GlkOte]: https://eblong.com/zarf/glk/glkote/docs.html
[GlkOteInit]: https://eblong.com/zarf/glk/glkote/docs.html#input

[Node.js][] must be available to run this script, but it does not use any Node modules aside from what's built into the included `ink.min.js`.

[Node.js]: https://nodejs.org/

## Usage

```
inkrun.js [ --start ] [ --autodir DIR ] GAME.ink.json
```

If `--start` is used, we start the Ink game, wait for the [`init`][GlkOteInit] event, and display the game's initial text. 

If `--start` is *not* used, we attempt to load the Ink game state from a file called `autosave.json`. (Use `--autodir` to determine what directory this file is found in.) Then we wait for a [`hyperlink`][GlkOteInit] event, select the choice, and display the game's response.

Either way, we write out `autosave.json` in preparation for the next turn.

## Credits

The inkrun.js script was written by Andrew Plotkin, and is in the public domain.

The [InkJS][] interpreter was created by Inkle and the InkJS contributors; it is distributed under the MIT license.
