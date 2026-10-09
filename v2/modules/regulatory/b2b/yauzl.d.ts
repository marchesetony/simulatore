declare module "yauzl" {
  import type { Readable } from "node:stream";
  export interface ExtraField { id: number; data: Buffer; }
  export interface Entry {
    fileName: string; fileNameRaw: Buffer; extraFields: ExtraField[];
    generalPurposeBitFlag: number; compressionMethod: number;
    compressedSize: number; uncompressedSize: number; crc32: number;
    versionNeededToExtract: number; versionMadeBy: number;
    externalFileAttributes: number; relativeOffsetOfLocalHeader: number;
    isEncrypted(): boolean;
  }
  export interface LocalFileHeader {
    fileName: Buffer; extraField: Buffer; generalPurposeBitFlag: number; compressionMethod: number;
    crc32: number; compressedSize: number; uncompressedSize: number;
  }
  export interface ZipFile {
    readEntry(): void;
    on(event: "entry", listener: (entry: Entry) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    once(event: "entry", listener: (entry: Entry) => void): this;
    once(event: "end", listener: () => void): this;
    once(event: "error", listener: (error: Error) => void): this;
    removeListener(event: "entry" | "end" | "error", listener: (...args: never[]) => void): this;
    openReadStreamPromise(entry: Entry): Promise<Readable>;
    readLocalFileHeaderPromise(entry: Entry, options?: { minimal?: boolean }): Promise<LocalFileHeader>;
    close(): void;
  }
  export function fromBufferPromise(buffer: Buffer, options?: {
    lazyEntries?: boolean; validateEntrySizes?: boolean;
    strictFileNames?: boolean; decodeStrings?: boolean;
  }): Promise<ZipFile>;
}
