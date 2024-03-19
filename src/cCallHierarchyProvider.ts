import * as fs from 'fs';
import * as vscode from 'vscode';
import * as lodash from 'lodash';
import * as childProcess from 'child_process';

let CSCOPE_PATH = 'cscope';
let CTAGS_PATH = 'ctags';
let READTAGS_PATH = 'readtags';

// TODO: to be downloaded in the future the same way as CSCOPE, CTAGS & READTAGS are downloaded
const PCRE2_EXE_PATH: string = 'C:/Users/hifna/Downloads/pcre2grep-1039/pcre2grep.exe';

const symbols: Record<string, vscode.SymbolKind> = {
   'd': vscode.SymbolKind.String,
   'e': vscode.SymbolKind.Enum,
   'f': vscode.SymbolKind.Function,
   'g': vscode.SymbolKind.EnumMember,
   'h': vscode.SymbolKind.File,
   'l': vscode.SymbolKind.Variable,
   'm': vscode.SymbolKind.Field,
   'p': vscode.SymbolKind.Function,
   's': vscode.SymbolKind.Struct,
   't': vscode.SymbolKind.Class,
   'u': vscode.SymbolKind.Struct,
   'v': vscode.SymbolKind.Variable,
   'x': vscode.SymbolKind.Variable,
   'z': vscode.SymbolKind.TypeParameter,
   'L': vscode.SymbolKind.Namespace,
   'D': vscode.SymbolKind.TypeParameter,

};

export function getCSCOPE_PATH(): string {
   return CSCOPE_PATH;
}

export function getCTAGS_PATH(): string {
   return CTAGS_PATH;
}

export function getREADTAGS_PATH(): string {
   return READTAGS_PATH;
}

export function setCSCOPE_PATH(path: string): void {
   CSCOPE_PATH = path;
}

export function setCTAGS_PATH(path: string): void {
   CTAGS_PATH = path;
}

export function setREADTAGS_PATH(path: string): void {
   READTAGS_PATH = path;
}

export enum ClickJumpLocation {
   SymbolDefinition = 'Symbol Definition',
   SymbolCall = 'Symbol Call'
}

export enum LogLevel {
   INFO,
   WARN,
   ERROR
}

export enum DatabaseType {
   CSCOPE = 1,
   CTAGS = 2,
   BOTH = 3
}

export class SymbolInfo {
   name: string;
   filePath: string;
   description: string;
   linePosition: number;

   constructor(name?: string, filePath?: string, position?: number, description?: string) {
      this.name = name ?? '';
      this.filePath = filePath ?? '';
      this.linePosition = position ?? -1;

      this.description = description ?? '';
   }

   public static convertToFuncInfo(line: string): SymbolInfo {
      const words = line.split(/\s+/);
      return new SymbolInfo(words[1], words[0], Number(words[2]));
   }

   public static convertToSymbolInfo(line: string): SymbolInfo {
      const words = line.split(/\s+/);

      const name = words[0].split(/[\\/]/).slice(-1)[0];

      return new SymbolInfo(name, words[0], Number(words[2]));
   }

   public getFileName(): string {
      const folders = this.filePath.split(/[\\/]/);

      return folders.slice(-1)[0];
   }

   public toString = () => `SymbolInfo(${this.name}, ${this.description}, ${this.filePath}, ${this.linePosition})`;
}

class Function {
   children: Array<string> = [];

   // TODO: to be implemented when finding children data is feasable
   // children: Array<Function> = [];

   constructor(
      public readonly filePath: string,
      public readonly lineNumber: number,
      public readonly name: string,
      public readonly body: string,
   ) { }
}

export class CCallHierarchyItem extends vscode.CallHierarchyItem {
   constructor(
      public readonly kind: vscode.SymbolKind,
      public readonly name: string,
      public readonly detail: string,
      public readonly uri: vscode.Uri,
      public readonly range: vscode.Range,
      public readonly selectionRange: vscode.Range,
      public readonly isIncludeItem: boolean
   ) {
      super(kind, name, detail, uri, range, selectionRange);
   }
}

export class CCallHierarchyProvider implements vscode.CallHierarchyProvider {
   private readonly cwd: string;
   private readonly outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel("C Call Hierarchy");
   private readonly functions: Array<Function> = [];

   constructor(private readonly extensionContext: vscode.ExtensionContext) {
      this.cwd = getWorkspaceRootPath();
      const functionsFilePath = this.extensionContext.asAbsolutePath('src/functions.json');
      this.functions = JSON.parse(fs.readFileSync(functionsFilePath, 'utf-8'));
   }

   async prepareCallHierarchy(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken): Promise<CCallHierarchyItem | CCallHierarchyItem[] | undefined> {
      // TODO: to be replaced when the new indexing function is finalized
      let buildOption = 0;
      let infoMessage = '';

      const { cscopesDbPath, ctagsDbPath } = getDatabasePath();
      if (!fs.existsSync(cscopesDbPath)) {
         infoMessage += `cscope database doesn't exist, rebuilding...\n`;
         buildOption |= 1 << 0;
      }

      if (!fs.existsSync(ctagsDbPath)) {
         infoMessage += `ctags database doesn't exist, rebuilding...`;
         buildOption |= 1 << 1;
      }

      if (buildOption > 0) {
         showMessageWindow(infoMessage);
         await buildDatabase(buildOption as DatabaseType);
      }
      // TODO: to be replaced when the new indexing function is finalized

      if (this.functions.length === 0) {
         await this.startIndexing();
      }

      const text = document.lineAt(position.line).text;

      const regex = /#include\s*[<"]?(?<fileName>\w+.h)[">]?\s*/;

      let item;
      if (regex.test(text)) {
         const match = regex.exec(text);
         const fileName = match!.groups!.fileName;

         item = new CCallHierarchyItem(
            vscode.SymbolKind.File,
            fileName,
            `@ ${(position.line + 1).toString()}`,
            document.uri,
            new vscode.Range(new vscode.Position(position.line, match!.index), new vscode.Position(position.line, text.length)),
            new vscode.Range(new vscode.Position(position.line, match!.index), new vscode.Position(position.line, text.length)),
            true
         );
      } else {
         // if (!this.showIncludeHierarchy) {
         const wordRange = document.getWordRangeAtPosition(position);

         if (wordRange !== undefined) {
            const symbol = new SymbolInfo(
               document.getText(wordRange),
               document.fileName.replace(this.cwd, '').replace(/[\\/]+/, ''),
               position.line + 1);

            const { description, filePath, symbolRange } = await this.getSymbolInfo(symbol, symbol.name, wordRange);

            item = new CCallHierarchyItem(
               // TODO: to be replaced when the new indexing function is finalized
               // await getSymbolKind(symbol.name),
               vscode.SymbolKind.Function,
               symbol.name,
               description,
               filePath,
               symbolRange,
               symbolRange,
               false
            );
         }
         // }
      }

      return item;
   }

   async provideCallHierarchyIncomingCalls(
      item: CCallHierarchyItem,
      token: vscode.CancellationToken): Promise<vscode.CallHierarchyIncomingCall[]> {
      const incomingCalls: Array<vscode.CallHierarchyIncomingCall> = new Array();

      if (item.isIncludeItem) {
         const includers: Array<SymbolInfo> = await findIncluders(item.name);

         for (const includer of includers) {
            try {
               const symbolRange = await this.getWordRange(`${this.cwd}/${includer.filePath}`, includer.linePosition - 1, item.name);

               const filePath = vscode.Uri.file(`${this.cwd}/${includer.filePath}`);

               const description = `@ ${includer.linePosition.toString()}`;

               const fromCaller = new CCallHierarchyItem(
                  vscode.SymbolKind.File,
                  includer.name,
                  description,
                  filePath,
                  symbolRange,
                  symbolRange,
                  true
               );

               incomingCalls.push(new vscode.CallHierarchyIncomingCall(fromCaller, [symbolRange]));
            } catch (ex) {
               console.log(ex);
            }
         }
      } else {
         // for (const cFunction of this.functions) {
         //    for (const child of cFunction.children) {
         //       if (item.name === child) {
         //          const symbolRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));

         //          const fromCaller = new CCallHierarchyItem(
         //             vscode.SymbolKind.Function,
         //             cFunction.name,
         //             '',
         //             vscode.Uri.file(''),
         //             symbolRange,
         //             symbolRange,
         //             false
         //          );

         //          incomingCalls.push(new vscode.CallHierarchyIncomingCall(fromCaller, [symbolRange]));
         //       }
         //    }
         // }

         // TODO: to be replaced when the new indexing function is finalized
         const callers = await findCallers(item.name);

         for (const callerItem of callers) {
            const { description, filePath, symbolRange } = await this.getSymbolInfo(callerItem, item.name);

            const fromCaller = new CCallHierarchyItem(
               await getSymbolKind(callerItem.name),
               callerItem.name,
               description,
               filePath,
               symbolRange,
               symbolRange,
               false
            );

            incomingCalls.push(new vscode.CallHierarchyIncomingCall(fromCaller, [symbolRange]));
         }
      }
      return incomingCalls;
   }

   async provideCallHierarchyOutgoingCalls(
      item: CCallHierarchyItem,
      token: vscode.CancellationToken): Promise<vscode.CallHierarchyOutgoingCall[]> {
      const { cscopesDbPath } = getDatabasePath();

      const outgoingCalls: Array<vscode.CallHierarchyOutgoingCall> = new Array();

      if (item.isIncludeItem) {
         await doCLI(`${CSCOPE_PATH} -d -f "${cscopesDbPath}" -L7 ${item.name}`).then(async (output) => {
            const filePath = output.split(/\s+/)[0];

            const document = await vscode.workspace.openTextDocument(`${this.cwd}/${filePath}`);

            for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
               const line = document.lineAt(lineNumber).text;

               const regex = /#include\s*[<"]?(?<fileName>\w+.h)[">]?\s*/;
               if (regex.test(line)) {
                  const match = regex.exec(line);
                  const fileName = match!.groups!.fileName;
                  const symbolRange = new vscode.Range(new vscode.Position(lineNumber, match!.index), new vscode.Position(lineNumber, line.length));

                  const toCallee = new CCallHierarchyItem(
                     vscode.SymbolKind.File,
                     fileName,
                     `@ ${lineNumber.toString()}`,
                     document.uri,
                     symbolRange,
                     symbolRange,
                     true
                  );

                  outgoingCalls.push(new vscode.CallHierarchyOutgoingCall(toCallee, [symbolRange]));
               }
            }
         }).catch((reason) => {
            console.trace();
            console.log(reason);
            showMessageWindow(String(reason), LogLevel.ERROR);
         });
      } else {
         const callees = await findCallees(item.name);

         for (const calleeItem of callees) {
            const { description, filePath, symbolRange } = await this.getSymbolInfo(calleeItem, calleeItem.name);

            const toCallee = new CCallHierarchyItem(
               await getSymbolKind(calleeItem.name),
               calleeItem.name,
               description,
               filePath,
               symbolRange,
               symbolRange,
               false
            );

            outgoingCalls.push(new vscode.CallHierarchyOutgoingCall(toCallee, [symbolRange]));
         }
      }

      return outgoingCalls;
   }

   async startIndexing(): Promise<void> {
      console.time('indexing took');
      this.outputChannel.show();

      const files = await vscode.workspace.findFiles('**/*.{c,h}');
      if (vscode.workspace.workspaceFolders !== undefined) {
         const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath;
         this.outputChannel.appendLine(`starting indexing of ${workspace}`);
         this.outputChannel.appendLine(`found: ${files.length} files`);
      }

      await vscode.window.withProgress({
         location: vscode.ProgressLocation.Window,
         cancellable: false
      }, async (progress) => {
         let indexingProgress = 0;
         progress.report({ increment: 0 });

         for (const { index, file } of files.map((file, index) => ({ index, file }))) {
            // const document = await vscode.workspace.openTextDocument(file);
            // const text = document.getText();

            if (vscode.workspace.workspaceFolders !== undefined) {
               indexingProgress = 100 * index / files.length;
               const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath;
               const docName = file.fsPath.replace(workspace, '').slice(1);
               const message = `(${indexingProgress.toFixed(1)} %) indexing ${docName}...`;

               this.outputChannel.appendLine('+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++');
               this.outputChannel.appendLine(`indexing ${file.fsPath}...`);

               const regexFilePath = this.extensionContext.asAbsolutePath('src/c_function_regex_pattern.txt');
               // const regexFilePath = path.join(this.extensionContext.extensionPath, 'src', 'c_function_regex_pattern.txt');

               const command = `${PCRE2_EXE_PATH} --line-number --om-separator=":" -o1 -o2 -H -N CRLF -iMf "${regexFilePath}" "${file.fsPath}"`;

               await doCLI(command).then((matches) => {
                  const functionsData = matches.trim().split(`${file.fsPath}:`).splice(1);

                  if (functionsData.length > 0) {
                     for (const functionData of functionsData.map(functionName => functionName.trim())) {
                        const functionComponenets = functionData.split(':');
                        const cFunction = new Function(file.fsPath, Number(functionComponenets[0]), functionComponenets[1], functionComponenets[2]);

                        cFunction.children = this.findFunctionCalls(cFunction.body);

                        this.outputChannel.appendLine(`${cFunction.lineNumber}: ${cFunction.name}`);
                        for (const functionName of cFunction.children) {
                           this.outputChannel.appendLine(`\t- ${functionName}`);
                        }

                        this.functions.push(cFunction);
                     }
                  }
               }).catch((reason) => {
                  if (reason !== '') {
                     console.trace();
                     this.outputChannel.appendLine(`ERROR: ${reason}`);
                  } else {
                     // this.outputChannel.appendLine(`no functions found`);
                  }
               });
               this.outputChannel.appendLine('+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n');

               progress.report({ message: message, increment: 100 / files.length });
            }
         }

         progress.report({ increment: 100 });

         console.log(this.functions);
         console.timeEnd('indexing took');
      });
   }

   private findFunctionCalls(functionBody: string): Array<string> {
      // Regular expression to match C function calls
      const functionCallRegex = /([a-zA-Z_]\w*)\s*\([^)]*\)\s*;/gm;

      // Array to store detected function calls
      const functionCalls: string[] = [];

      // Iterate through matches and extract function names
      let match;

      // TODO: find a way to get full Function info of functionCalls
      while ((match = functionCallRegex.exec(functionBody)) !== null) {
         functionCalls.push(match[1]);
      }

      return functionCalls;
   }

   private async getSymbolInfo(symbol: SymbolInfo, relative: string, range?: vscode.Range): Promise<{ description: string; filePath: vscode.Uri; symbolRange: vscode.Range; }> {
      const config = vscode.workspace.getConfiguration('ccallhierarchy');
      const canShowFileNames = config.get('showFileNamesInSearchResults');
      const clickJumpLocation = config.get('clickJumpLocation');
      const { cscopesDbPath } = getDatabasePath();

      let symbolRange = range ?? await this.getWordRange(`${this.cwd}/${symbol.filePath}`, symbol.linePosition - 1, relative);
      let filePath = vscode.Uri.file(`${this.cwd}/${symbol.filePath}`);
      let description = `${canShowFileNames ? symbol.getFileName() : ''} @ ${symbol.linePosition.toString()}`;

      if (clickJumpLocation === ClickJumpLocation.SymbolDefinition) {
         await doCLI(`${CSCOPE_PATH} -d -f "${cscopesDbPath}" -L1 ${relative}`).then(async (definition) => {
            if (definition.length > 0) {
               const funcInfo = SymbolInfo.convertToFuncInfo(definition as string);

               symbolRange = await this.getWordRange(`${this.cwd}/${funcInfo.filePath}`, funcInfo.linePosition - 1, funcInfo.name);
               filePath = vscode.Uri.file(`${this.cwd}/${funcInfo.filePath}`);
               description = `${canShowFileNames ? funcInfo.getFileName() : ''} @ ${funcInfo.linePosition.toString()}`;
            }
         }).catch((reason) => {
            console.trace();
            console.log(reason);
            showMessageWindow(String(reason), LogLevel.ERROR);
         });
      }
      return { description, filePath, symbolRange };
   }

   private async getWordRange(filePath: string, linePosition: number, word: string): Promise<vscode.Range> {
      const document = await vscode.workspace.openTextDocument(filePath);
      const text = document.lineAt(linePosition);

      const match = new RegExp(`#include\\s*(.*${word}.*)`, "i").exec(text.text);
      if (match) {
         const wordIndex = match.index;

         const callerItemPositionStart = new vscode.Position(linePosition, wordIndex);
         const callerItemPositionEnd = new vscode.Position(linePosition, wordIndex + match[0].length);
         const callerItemRange = new vscode.Range(callerItemPositionStart, callerItemPositionEnd);

         return callerItemRange;
      } else {
         return new vscode.Range(new vscode.Position(linePosition, 0), new vscode.Position(linePosition, 0));
      }
   }
}

export function getDatabasePath() {
   const config = vscode.workspace.getConfiguration('ccallhierarchy');
   const databasePath = `${getWorkspaceRootPath()}/${config.get('databasePath')}`;

   if (!fs.existsSync(databasePath)) {
      fs.mkdirSync(databasePath, { recursive: true });
   }

   return {
      cscopesDbPath: `${databasePath}/cscope.out`,
      ctagsDbPath: `${databasePath}/ctags.out`
   };
}

export async function buildDatabase(buildOption: DatabaseType): Promise<void> {
   await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      // location: vscode.ProgressLocation.Window,
      // title: "Database Build",
      // cancellable: true
   }, async (progress/* , token */) => {
      // token.onCancellationRequested(() => {
      // 	console.log("User canceled the long running operation");
      // });

      const { cscopesDbPath, ctagsDbPath } = getDatabasePath();

      if ((buildOption === DatabaseType.CSCOPE) || (buildOption === DatabaseType.BOTH)) {
         progress.report({ increment: 0, message: "Building Database..." });

         // showMessageWindow('Building cscope Database...');

         await doCLI(`${CSCOPE_PATH} -Rcbkf "${cscopesDbPath}"`).catch((reason) => {
            console.trace();
            console.log(reason);
            showMessageWindow(String(reason), LogLevel.ERROR);
         });

         await delayMs(500);
      }

      if ((buildOption === DatabaseType.CTAGS) || (buildOption === DatabaseType.BOTH)) {
         progress.report({ increment: 50, message: "Building ctags database..." });

         // showMessageWindow('Building ctags Database...');

         await doCLI(`${CTAGS_PATH} --fields=+i -Rno "${ctagsDbPath}"`).catch((reason) => {
            console.trace();
            console.log(reason);
            showMessageWindow(String(reason), LogLevel.ERROR);
         });

         await delayMs(500);
      }
      progress.report({ increment: 100, message: "Finished building database" });

      // showMessageWindow('Finished building database');

      await delayMs(1500);
   });
}

export async function findIncluders(fileName: string): Promise<Array<SymbolInfo>> {
   const { cscopesDbPath } = getDatabasePath();

   const ret = await doCLI(`${CSCOPE_PATH} -d -f "${cscopesDbPath}" -L8 ${fileName}`).then((data) => {
      const includers: Array<SymbolInfo> = new Array();
      const lines = data.split('\n');

      for (const line of lines) {
         if (line.length > 0) {
            includers.push(SymbolInfo.convertToSymbolInfo(line));
         }
      }

      return includers;
   }).catch((reason) => {
      console.trace();
      console.log(reason);
      showMessageWindow(String(reason), LogLevel.ERROR);
   });

   return ret instanceof Array ? ret : new Array<SymbolInfo>();
}

export async function findCallers(funcName: string): Promise<Array<SymbolInfo>> {
   const { cscopesDbPath } = getDatabasePath();

   const callers = await doCLI(`${CSCOPE_PATH} -d -f "${cscopesDbPath}" -L3 ${funcName}`).then((data: string) => {
      const lines = data.split('\n');

      return lodash.chain(lines)
         .filter((value: string) => (value.length > 0))
         .flatMap((value: string) => SymbolInfo.convertToFuncInfo(value))
         .groupBy(x => x.linePosition)
         .map(group => (group as Array<SymbolInfo>).slice(-1)[0])
         .value();
   }).catch((reason) => {
      console.trace();
      console.log(reason);
      showMessageWindow(String(reason), LogLevel.ERROR);
   });

   console.log(callers instanceof Array);

   return callers instanceof Array ? callers : new Array<SymbolInfo>();
}

export async function findCallees(funcName: string): Promise<Array<SymbolInfo>> {
   const { cscopesDbPath } = getDatabasePath();

   const callees = await doCLI(`${CSCOPE_PATH} -d -f "${cscopesDbPath}" -L2 ${funcName}`).then((data: string) => {
      const lines = data.split('\n');

      // for (const line of lines) {
      //    if (line.length > 0) {
      //       const funcInfo = SymbolInfo.convertToFuncInfo(line);
      //       callees.push(funcInfo);
      //    }z
      // }

      return lodash.chain(lines)
         .filter((value: string) => (value.length > 0))
         .flatMap((value: string) => SymbolInfo.convertToFuncInfo(value))
         .groupBy(x => x.linePosition)
         .map(group => (group as Array<SymbolInfo>).slice(-1)[0])
         .value();
   }).catch((reason) => {
      console.trace();
      console.log(reason);
      showMessageWindow(String(reason), LogLevel.ERROR);
   });

   return callees instanceof Array ? callees : new Array<SymbolInfo>();
}

export async function getSymbolKind(symbolName: string): Promise<vscode.SymbolKind> {
   const { ctagsDbPath } = getDatabasePath();

   const data = process.platform === 'win32' ?
      await doCLI(`${READTAGS_PATH} -t "${ctagsDbPath}" -F "(list $name \\" \\" $input \\" \\" $line \\" \\" $kind #t)" ${symbolName}`).catch((reason) => {
         console.trace();
         console.log(reason);
         showMessageWindow(String(reason), LogLevel.ERROR);
      }) :
      await doCLI(`${READTAGS_PATH} -t "${ctagsDbPath}" -F '(list $name " " $input " " $line " " $kind #t)' ${symbolName}`).catch((reason) => {
         console.trace();
         console.log(reason);
         showMessageWindow(String(reason), LogLevel.ERROR);
      });

   let kind: vscode.SymbolKind = vscode.SymbolKind.Null;

   if (typeof data === 'string') {
      const lines = data.split(/\n/);

      for (const line of lines) {
         const fields = line.split(/\s+/);

         if (fields.length >= 4) {
            if (fields[3] === 'd') {
               const docLines = (await vscode.workspace.openTextDocument(`${getWorkspaceRootPath()}/${fields[1]}`)).getText().split(/\n/gi);
               const definition = docLines[Number(fields[2]) - 1];
               const regex = new RegExp(`#define\\s*${fields[0]}\\s*\\(`, 'gi');

               if (regex.test(definition)) { // this is a macro
                  kind = vscode.SymbolKind.Field;
               } else {
                  kind = (fields[3] in symbols) ? symbols[fields[3]] : vscode.SymbolKind.Null;
               }

            } else {
               kind = (fields[3] in symbols) ? symbols[fields[3]] : vscode.SymbolKind.Null;
            }
         }
      }
   }

   return kind;
}

export async function doCLI(command: string): Promise<string> {
   const dir = getWorkspaceRootPath();

   return new Promise((resolve, reject) => {
      childProcess.exec(
         command,
         {
            cwd: dir,
            maxBuffer: 1024 * 1024 * 1024 * 1024 * 10
         },
         async (error: childProcess.ExecException | null, stdout: string, stderr: string) => {
            if (error) {
               // showMessageWindow(stderr, LogLevel.ERROR);
               reject(stderr);
            } else {
               resolve(stdout);
            }
         });
   });
}

export function getWorkspaceRootPath(): string {
   return vscode.workspace.workspaceFolders !== undefined ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
}

export function showMessageWindow(msg: string, logLevl: LogLevel = LogLevel.INFO): void {
   const config = vscode.workspace.getConfiguration('ccallhierarchy');
   const canShowMessages = config.get('showMessages');

   if (canShowMessages) {
      switch (logLevl) {
         case LogLevel.INFO:
            vscode.window.showInformationMessage(msg);
            break;
         case LogLevel.WARN:
            vscode.window.showWarningMessage(msg);
            break;
         case LogLevel.ERROR:
            vscode.window.showErrorMessage(msg);
            break;
         default:
            break;
      }
   }
}

async function delayMs(ms: number): Promise<undefined> {
   return new Promise<undefined>(resolve => setTimeout(resolve, ms));
}