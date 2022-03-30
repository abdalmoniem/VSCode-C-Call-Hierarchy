# VSCode - C Call Hierarchy README

This extension creates C call graph (call hierarchy), using the cscope utility.

## Features

The main feature is creating a call hierarchy graph, for C code.


> Tip: After creating the call hierarchy, it is possible to jump to any function definition or usage.

## Requirements

This extension uses the cscope utility.

### Install on Linux

sudo apt install cscope

### Install on Mac

brew install cscope

### Install on Windows

install cscope using cygwin or any other unix environment

## Release Notes

### 1.2.3

Added Collapse/Expand Buttons to TreeView


-----------------------------------------------------------------------------------------------------------

## Using with C Call Hierarchy

* Build the cscope database using the build command. The build command can be accessed using the command palette (`Build Database`), or from the editor context (`mouse right click + Build Database`).
* Open the call hierarchy by selecting a function, and issue the show command `Show Call Hierarchy` (from the command palette or from the editor context).
* While hoverring over CCallHierarchy entry clicking `Goto Line` will open the editor on the calling line, while clicking `Goto Def` will open the editor on the definition of the function.
