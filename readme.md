Galkomponents — UI components for galleries.

Currently only one component is implemented: the *Property Sheet*.

The property sheet replaces Danbooru's read-only tag list in the left panel with an enriched list
which is directly editable. It aims to fully supercede the traditional tag-editing form,
though currently the property sheet and edit form can be used interchangably as they
synchronise bidirectionally.

Active on pages `*://*.donmai.us/posts/*` ; must be logged-in.

Adding tags | Editing tags | Autocomplete | Wiki entries
--- | --- | --- | ---
![][demo tagging a] | ![][demo tagging b] | ![][demo autocmpl a] | ![][demo wiki a]

(todo: more screenshots)

# Stability warning

This codebase is currently in the alpha stage. When making changes to large tag sets
via the property sheet, it is highly recommended to double-check that the intended changes
were applied after saving.

Usability issues and bugs and with the propensity for data loss / unintended results
are treated as high priority.

# Installation

## Compatibility

The following browsers have been tested:

- Chrome version 87

- Firefox version 84

- Firefox version 56 (with preference `dom.moduleScripts.enabled = true`)

## Firefox

- Select the desired `galkomponents-{VERSION}-an+fx.xpi`
from https://github.com/bipface/galkomponents/releases

## Chrome

- Download the codebase.

- Go to `chrome://extensions`.

- Ensure the *Developer mode* switch is *on*.

- Select *Load unpacked*.

- Choose the directory containing the downloaded code.

## Firefox - testing

- Download the codebase.

- Go to `about:debugging#addons`.

- Select *Load Temporary Add-on*.

- Choose `manifest.json` from the directory containing the downloaded code.

Add-ons installed in this manner will remain installed until the browser is closed.

# Hotkeys

Key | Action
:---: | ---
`shift+enter` | Toggle side-panel
`tab`/`shift+tab` | Navigate properties
`↑`/`↓` | Navigate autocomplete
`ctrl+enter` | Submit
`F2` | Edit property

# Known issues and shortcomings

- Source links need `rel='external noreferrer nofollow'`.

- Untested with the site's 'light' theme.

- Metatag parsing isn't precise; e.g. `type:_null` is treated as a metatag.

- Textboxes for meta-properties should to be parsed differently,
so you can just type `1234` instead of `parent:1234` into the parent field.

- 'Translated tags' panel is not implemented yet.

- Side-panel overlaps textboxes.

- Keyboard accessibility in general is only half-baked.

- Selecting from 'recent tags'/'related tags' under the edit form
doesn't update property sheet.

- Double-clicking in a property textbox doesn't select the text (Firefox bug).

- After committing text into a textbox, the autocomplete panel may not be cleared.
This is a Chrome bug, with the browser not firing the `selectionchange` event.

- Wiki panel has a vertical scrollbar when not necessary.

- Pressing `enter` with a menu button (e.g. *Tags···*) focused sometimes
activates the first menu item instead of toggling the menu.

- After selecting a menu item (using `enter` or `space`),
the item is highlighted again when the menu is re-opened.

- In Chrome, extraneous network requests for SVG images which don't exist on the server.

- Copying selected properties; feature isn't fully refined and suffers in a number of edge cases.

- 'Unrecognised' section shouldn't be present when empty.

- Various menu items not implemented yet.

- Pressing the *Edit* button on long tags somehow shifts the label to the left.

- Certain metatags don't behave as expected when used with
the minus (`-`) operator (e.g. `-pool:1`).

- `embedded:` metatag sometimes returns an error message upon submit.

- Licence (considering icon images).

# Future plans

- Upload page.

- Preferences
	- Layout of button groups
	- (more)

- Earlier and more seamless initialisation.

- Recognise tag category metatags (`character:`, etc.)

- Formatting in the wiki panel.

- e621, Gelbooru, …

- (todo: fill out this list)

[demo tagging a]: https://i.imgur.com/iamexoR.gif
[demo tagging b]: https://i.imgur.com/fC0PkhU.gif
[demo autocmpl a]: https://i.imgur.com/W2a7dV2.gif
[demo wiki a]: https://i.imgur.com/bfd6MZG.gif
