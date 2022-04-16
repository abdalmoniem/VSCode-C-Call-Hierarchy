# VSCode - C Call Hierarchy
This extension creates C call hierarchy, using `cscope`, `ctags` and, `readtags`.

![screenshot1](https://github.com/abdalmoniem/C-Call-Hierarchy/raw/master/media/screenshot1.png)
![screenshot2](https://github.com/abdalmoniem/C-Call-Hierarchy/raw/master/media/screenshot2.png)
![screenshot3](https://github.com/abdalmoniem/C-Call-Hierarchy/raw/master/media/screenshot3.png)

## Features
The main feature is creating a call hierarchy for C code.

## Requirements
This extension uses the cscope, ctags and, readtags (**_universal-ctags_**)

### Installation on Linux/Unix (Mac)
use `brew`

```shell
brew install cscope universal-ctags
```

> N.B.1 `brew`'s `universal-ctags` provides the best implementation of `ctags` and `readtags` so it is highly recommended to use `brew` to install it
> N.B.2 it is highly un-recommended to use the native package manager to install this package unless you're sure that it's going to install the same implementation as `brew`'s

### Installation on Windows
* install `cscope` using cygwin or any other unix like environment or download it from [here](https://github.com/abdalmoniem/C-Call-Hierarchy/releases/download/v1.7.4/cscope.zip)
* install `ctags` & `readtags` using cygwin or any other unix like environment or download it from [here](https://github.com/abdalmoniem/C-Call-Hierarchy/releases/download/v1.7.4/ctags.zip)

make sure to add the following to the `PATH` environment variable:
1. `CTAGS_DIR`/ctags
2. `CSCOPE_DIR`/cscope
3. `CSCOPE_DIR`/cscope/UnxUtils/bin
4. `CSCOPE_DIR`/cscope/UnxUtils/usr/local/wbin

-----------------------------------------------------------------------------------------------------------

## Using C Call Hierarchy
* Upon extension activation, you'll be prompted to install the `CSCOPE` and `CTAGS` dependencies (if you're on windows for now), click `Yes` to install these dependencies
* Open the call hierarchy by selecting a function, and issue the show command `Show Call Hierarchy` (from the command palette or from the editor context menu).
* The extension tries to build the `cscope` & `ctags` databases when you issue the `Show Call Hierarchy` command and the `cscope.out` and/or `ctags.out` file[s] is/are not found. If this doesn't happen and the files are not created, you can manually issue a database build from the command palette using the command `C Call Hierarchy: Build Database`.
* explore extension settings to configure how the extension works as you like.