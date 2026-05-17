export interface FileSystemPort {
  readFile(path: string): Promise<string>;
  mergeManifests(...files: string[]): Promise<string>;
}
