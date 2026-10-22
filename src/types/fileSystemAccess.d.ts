/**
 * Minimal type declarations for the File System Access API.
 *
 * The DOM library of TypeScript already declares the handles
 * (`FileSystemDirectoryHandle`, `FileSystemFileHandle`, `FileSystemWritableFileStream`)
 * and the asynchronous iteration over the entries of a directory. What it does
 * not declare is the picker (`window.showDirectoryPicker`) and the permission
 * methods of the handles, so they are declared here: no extra dependency is
 * needed.
 *
 * The API is only offered by the Chromium based browsers (Chrome, Edge,
 * Opera). The application checks for it before using it.
 */

/** The access the application asks for on a directory. */
type FileSystemAccessMode = 'read' | 'readwrite';

/** The options of the permission methods of a handle. */
interface FileSystemPermissionDescriptor {
  readonly mode?: FileSystemAccessMode;
}

interface FileSystemHandle {
  /**
   * The state of the permission, without asking the user anything.
   *
   * `granted` when the access is already allowed, `prompt` when the browser
   * will ask the user, `denied` when the access is refused.
   */
  queryPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
  /**
   * Asks the user for the access.
   *
   * The browser only allows this method when it is called from a user gesture.
   */
  requestPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
}

/** The options of the directory picker. */
interface FileSystemDirectoryPickerOptions {
  /** The name of the directory, to remember it between two visits. */
  readonly id?: string;
  /** The access the application asks for. */
  readonly mode?: FileSystemAccessMode;
  /** The folder the picker starts in. */
  readonly startIn?: string | FileSystemHandle;
}

interface Window {
  /**
   * Shows the picker of the browser: the user chooses a folder of the disk.
   *
   * The browser only allows this method when it is called from a user
   * gesture, and it throws when the user closes the picker without choosing
   * anything.
   */
  showDirectoryPicker?(
    options?: FileSystemDirectoryPickerOptions,
  ): Promise<FileSystemDirectoryHandle>;
}
