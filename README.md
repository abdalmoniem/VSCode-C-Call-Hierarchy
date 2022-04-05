# VSCode - C Call Hierarchy README
This extension creates C call graph (call hierarchy), using the cscope utility.

![screenshot1](https://github.com/abdalmoniem/C-Call-Hierarchy/raw/master/media/screenshot1.png) ![screenshot1](https://github.com/abdalmoniem/C-Call-Hierarchy/raw/master/media/screenshot2.png)

## Features
The main feature is creating a call hierarchy graph, for C code.

## Requirements
This extension uses the cscope utility.

### Install on Linux
use native package manager to install cscope

e.g.: on debian:
```shell
sudo apt install cscope
```

### Install on Mac
you can use brew:

```shell
brew install cscope
```

### Install on Windows
install cscope using cygwin or any other unix like environment or download it from [here](https://github.com/abdalmoniem/C-Call-Hierarchy/releases/download/v1.5.0/cscope.zip)

make sure to add the following to the `PATH` environment variable:
1. "CSCOPE_DIR"/cscope
2. "CSCOPE_DIR"/cscope/UnxUtils/bin
3. "CSCOPE_DIR"/cscope/UnxUtils/usr/local/wbin

-----------------------------------------------------------------------------------------------------------

## Using C Call Hierarchy
* Open the call hierarchy by selecting a function, and issue the show command `Show Call Hierarchy` (from the command palette or from the editor context).
* The extension tries to build the cscope database when you issue the `Show Call Hierarchy` command and the `cscope.out` file is not found. If this doesn't happen and the file is not created, you can manually issue a cscope database build from the command palette using the command `Build Database`.
* explore extension settings to configure how the extension works as you like.

