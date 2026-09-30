import type { LoadedFile } from "../../benchmark/src/types.ts";

export const sortLoadedFiles = (files: readonly LoadedFile[]): LoadedFile[] => {
  const unique = new Map<string, LoadedFile>();
  for (const file of files) {
    if (!unique.has(file.fileName)) unique.set(file.fileName, file);
  }
  return [...unique.values()].sort((left, right) => {
    if (left.sizeBytes !== right.sizeBytes)
      return right.sizeBytes - left.sizeBytes;
    return left.fileName < right.fileName
      ? -1
      : left.fileName > right.fileName
        ? 1
        : 0;
  });
};

export const formatFileSize = (sizeBytes: number): string => {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  return `${(sizeBytes / 1024).toFixed(1)} KiB (${sizeBytes} B)`;
};
