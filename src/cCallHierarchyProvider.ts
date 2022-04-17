import * as fs from 'fs';
import * as vscode from 'vscode';
import * as childProcess from 'child_process';

let CSCOPE_PATH = 'cscope';
let CTAGS_PATH = 'ctags';
let READTAGS_PATH = 'readtags';

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
      let words = line.split(/\s+/);
      return new SymbolInfo(words[1], words[0], Number(words[2]));
   }

   public static convertToSymbolInfo(line: string): SymbolInfo {
      let words = line.split(/\s+/);

      let name = words[0].split(/[\\/]/).slice(-1)[0];

      return new SymbolInfo(name, words[0], Number(words[2]));
   }

   public getFileName(): string {
      let folders = this.filePath.split(/[\\/]/);

      return folders.slice(-1)[0];
   }
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

   constructor() {
      this.cwd = getWorkspaceRootPath();
   }

   async prepareCallHierarchy(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken): Promise<CCallHierarchyItem | CCallHierarchyItem[] | undefined> {
      let buildOption = 0;
      let infoMessage = '';

      if (!fs.existsSync(`${this.cwd}/cscope.out`)) {
         infoMessage += `cscope database doesn't exist, rebuilding...\n`;
         buildOption |= 1 << 0;
      }

      if (!fs.existsSync(`${this.cwd}/ctags.out`)) {
         infoMessage += `ctags database doesn't exist, rebuilding...`;
         buildOption |= 1 << 1;
      }

      if (buildOption > 0) {
         showMessageWindow(infoMessage);
         await buildDatabase(buildOption as DatabaseType);
      }

      let text = document.lineAt(position.line).text;

      let regex = /#include\s*[<"]?(?<fileName>\w+.h)[">]?\s*/;

      let item;
      if (regex.test(text)) {
         let match = regex.exec(text);
         let fileName = match!.groups!.fileName;

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
         let wordRange = document.getWordRangeAtPosition(position);

         if (wordRange !== undefined) {
            let symbol = new SymbolInfo(
               document.getText(wordRange),
               document.fileName.replace(this.cwd, '').replace(/[\\/]+/, ''),
               position.line + 1);

            let { description, filePath, symbolRange } = await this.getSymbolInfo(symbol, symbol.name, wordRange);

            item = new CCallHierarchyItem(
               await getSymbolKind(symbol.name),
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
      let incomingCalls: Array<vscode.CallHierarchyIncomingCall> = new Array();

      if (item.isIncludeItem) {
         let includers: Array<SymbolInfo> = await findIncluders(item.name);

         for (let includer of includers) {
            let symbolRange = await this.getWordRange(`${this.cwd}/${includer.filePath}`, includer.linePosition - 1, item.name);

            let filePath = vscode.Uri.file(`${this.cwd}/${includer.filePath}`);

            let description = `@ ${includer.linePosition.toString()}`;

            let fromCaller = new CCallHierarchyItem(
               vscode.SymbolKind.File,
               includer.name,
               description,
               filePath,
               symbolRange,
               symbolRange,
               true
            );

            incomingCalls.push(new vscode.CallHierarchyIncomingCall(fromCaller, [symbolRange]));
         }
      } else {
         let callers = await findCallers(item.name);

         for (let callerItem of callers) {
            let { description, filePath, symbolRange } = await this.getSymbolInfo(callerItem, item.name);

            let fromCaller = new CCallHierarchyItem(
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
      let outgoingCalls: Array<vscode.CallHierarchyOutgoingCall> = new Array();

      if (item.isIncludeItem) {
         const filePath = (await doCLI(`${CSCOPE_PATH} -d -f cscope.out -L7 ${item.name}`)).split(/\s+/)[0];
         const document = await vscode.workspace.openTextDocument(`${this.cwd}/${filePath}`);

         for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
            const line = document.lineAt(lineNumber).text;

            let regex = /#include\s*[<"]?(?<fileName>\w+.h)[">]?\s*/;
            if (regex.test(line)) {
               let match = regex.exec(line);
               let fileName = match!.groups!.fileName;
               let symbolRange = new vscode.Range(new vscode.Position(lineNumber, match!.index), new vscode.Position(lineNumber, line.length));

               let toCallee = new CCallHierarchyItem(
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
      } else {
         let callees = await findCallees(item.name);

         for (let calleeItem of callees) {
            let { description, filePath, symbolRange } = await this.getSymbolInfo(calleeItem, calleeItem.name);

            let toCallee = new CCallHierarchyItem(
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

   private async getSymbolInfo(symbol: SymbolInfo, relative: string, range?: vscode.Range): Promise<{ description: string; filePath: vscode.Uri; symbolRange: vscode.Range; }> {
      let config = vscode.workspace.getConfiguration('ccallhierarchy');
      let canShowFileNames = config.get('showFileNamesInSearchResults');
      let clickJumpLocation = config.get('clickJumpLocation');

      let symbolRange = range ?? await this.getWordRange(`${this.cwd}/${symbol.filePath}`, symbol.linePosition - 1, relative);

      let filePath = vscode.Uri.file(`${this.cwd}/${symbol.filePath}`);

      let description = `${canShowFileNames ? symbol.getFileName() : ''} @ ${symbol.linePosition.toString()}`;

      if (clickJumpLocation === ClickJumpLocation.SymbolDefinition) {
         let definition = await doCLI(`${CSCOPE_PATH} -d -f cscope.out -L1 ${relative}`);

         if (definition.length > 0) {
            let funcInfo = SymbolInfo.convertToFuncInfo(definition as string);

            symbolRange = await this.getWordRange(`${this.cwd}/${funcInfo.filePath}`, funcInfo.linePosition - 1, funcInfo.name);

            filePath = vscode.Uri.file(`${this.cwd}/${funcInfo.filePath}`);

            description = `${canShowFileNames ? funcInfo.getFileName() : ''} @ ${funcInfo.linePosition.toString()}`;
         }
      }
      return { description, filePath, symbolRange };
   }

   private async getWordRange(filePath: string, linePosition: number, word: string): Promise<vscode.Range> {
      let document = await vscode.workspace.openTextDocument(filePath);
      let text = document.lineAt(linePosition);

      let wordIndex = new RegExp(`\\b${word}\\b`, "i").exec(text.text)!.index;

      let callerItemPositionStart = new vscode.Position(linePosition, wordIndex);
      let callerItemPositionEnd = new vscode.Position(linePosition, wordIndex + word.length);
      let callerItemRange = new vscode.Range(callerItemPositionStart, callerItemPositionEnd);

      return callerItemRange;
   }
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

      if ((buildOption === DatabaseType.CSCOPE) || (buildOption === DatabaseType.BOTH)) {
         progress.report({ increment: 0, message: "Building Database..." });

         // showMessageWindow('Building cscope Database...');

         await doCLI(`${CSCOPE_PATH} -Rcbkf cscope.out`);

         await delay(500);
      }

      if ((buildOption === DatabaseType.CTAGS) || (buildOption === DatabaseType.BOTH)) {
         progress.report({ increment: 50, message: "Building ctags database..." });

         // showMessageWindow('Building ctags Database...');

         await doCLI(`${CTAGS_PATH} --fields=+i -Rno ctags.out`);

         await delay(500);
      }
      progress.report({ increment: 100, message: "Finished building database" });

      // showMessageWindow('Finished building database');

      await delay(1500);
   });
}

export async function findIncluders(fileName: string): Promise<Array<SymbolInfo>> {
   let includers: Array<SymbolInfo> = new Array();

   let data: string = await doCLI(`${CSCOPE_PATH} -d -f cscope.out -L8 ${fileName}`) as string;

   let lines = data.split('\n');

   for (let line of lines) {
      if (line.length > 0) {
         includers.push(SymbolInfo.convertToSymbolInfo(line));
      }
   }

   return includers;
}

export async function findCallers(funcName: string): Promise<Array<SymbolInfo>> {
   let callers: Array<SymbolInfo> = new Array();

   let data: string = await doCLI(`${CSCOPE_PATH} -d -f cscope.out -L3 ${funcName}`) as string;

   let lines = data.split('\n');

   for (let line of lines) {
      if (line.length > 0) {
         let funcInfo = SymbolInfo.convertToFuncInfo(line);
         callers.push(funcInfo);
      }
   }

   return callers;
}

export async function findCallees(funcName: string): Promise<Array<SymbolInfo>> {
   let callees: Array<SymbolInfo> = new Array();

   let data: string = await doCLI(`${CSCOPE_PATH} -d -f cscope.out -L2 ${funcName}`) as string;

   let lines = data.split('\n');

   for (let line of lines) {
      if (line.length > 0) {
         let funcInfo = SymbolInfo.convertToFuncInfo(line);
         callees.push(funcInfo);
      }
   }

   return callees;
}

export async function getSymbolKind(symbolName: string): Promise<vscode.SymbolKind> {
   let data = process.platform === 'win32' ?
      await doCLI(`${READTAGS_PATH} -t ctags.out -F "(list $name \\" \\" $input \\" \\" $line \\" \\" $kind #t)" ${symbolName}`) :
      await doCLI(`${READTAGS_PATH} -t ctags.out -F '(list $name " " $input " " $line " " $kind #t)' ${symbolName}`);

   let lines = data.split(/\n/);

   let kind: vscode.SymbolKind = vscode.SymbolKind.Constant;

   for (let line of lines) {
      let fields = line.split(/\s+/);

      if (fields.length >= 4) {
         switch (fields[3]) {
            case 'd':
               kind = vscode.SymbolKind.Constant;
               break;
            case 'e':
               kind = vscode.SymbolKind.Enum;
               break;
            case 'f':
               kind = vscode.SymbolKind.Function;
               break;
            case 'g':
               kind = vscode.SymbolKind.EnumMember;
               break;
            case 'h':
               kind = vscode.SymbolKind.File;
               break;
            case 'l':
               kind = vscode.SymbolKind.Variable;
               break;
            case 'm':
               kind = vscode.SymbolKind.Field;
               break;
            case 'p':
               kind = vscode.SymbolKind.Function;
               break;
            case 's':
               kind = vscode.SymbolKind.Struct;
               break;
            case 't':
               kind = vscode.SymbolKind.Class;
               break;
            case 'u':
               kind = vscode.SymbolKind.Struct;
               break;
            case 'v':
               kind = vscode.SymbolKind.Variable;
               break;
            case 'x':
               kind = vscode.SymbolKind.Variable;
               break;
            case 'z':
               kind = vscode.SymbolKind.TypeParameter;
               break;
            case 'L':
               kind = vscode.SymbolKind.Namespace;
               break;
            case 'D':
               kind = vscode.SymbolKind.TypeParameter;
               break;
            default:
               kind = vscode.SymbolKind.Class;
               break;
         }
      }
   }

   return kind;
}

export async function doCLI(command: string): Promise<string> {
   let dir = getWorkspaceRootPath();

   return new Promise((resolve, reject) => {
      childProcess.exec(
         command,
         { cwd: dir },
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
   let config = vscode.workspace.getConfiguration('ccallhierarchy');
   let canShowMessages = config.get('showMessages');

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

async function delay(ms: number): Promise<undefined> {
   return new Promise<undefined>(resolve => setTimeout(resolve, ms));
}