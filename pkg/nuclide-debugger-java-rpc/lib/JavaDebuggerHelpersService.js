/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 * @format
 */

import type {NuclideUri} from 'nuclide-commons/nuclideUri';
import type {VSAdapterExecutableInfo} from 'nuclide-debugger-common';

import fsPromise from 'nuclide-commons/fsPromise';
import nuclideUri from 'nuclide-commons/nuclideUri';
import UniversalDisposable from 'nuclide-commons/UniversalDisposable';
import os from 'os';
import {runCommand} from 'nuclide-commons/process';
import {Observable} from 'rxjs';
import {getAvailableServerPort} from '../../commons-node/serverPort';

export type JavaLaunchTargetInfo = {|
  +debugMode: 'launch',
  +commandLine: string,
  +classPath: string,
  +runArgs?: ?Array<string>,
|};

export type JavaAttachPortTargetInfo = {|
  +debugMode: 'attach',
  +machineName: string,
  +port: number,
|};

export type JavaTargetInfo = JavaLaunchTargetInfo | JavaAttachPortTargetInfo;

export type TerminalLaunchInfo = {|
  +launchCommand: string,
  +launchCwd: NuclideUri,
  +targetExecutable: NuclideUri,
  +launchArgs: Array<string>,
  +attachPort: number,
  +attachHost: string,
|};

const JAVA = 'java';

export async function getPortForJavaDebugger(): Promise<number> {
  return getAvailableServerPort();
}

export async function getJavaVSAdapterExecutableInfo(
  debug: boolean,
): Promise<VSAdapterExecutableInfo> {
  return {
    command: JAVA,
    args: await _getJavaArgs(debug),
  };
}

export async function prepareForTerminalLaunch(
  launchInfo: JavaLaunchTargetInfo,
): Promise<TerminalLaunchInfo> {
  const {classPath, commandLine} = launchInfo;
  const launchPath = nuclideUri.expandHomeDir(classPath);
  const attachPort = await getAvailableServerPort();

  // Note: the attach host is passed to the Java debugger engine, which
  // runs on the RPC side of Nuclide, so it is fine to always pass localhost
  // as the host name, even if the Nuclide client is on a different machine.
  const attachHost = '127.0.0.1';
  return Promise.resolve({
    attachPort,
    attachHost,
    launchCommand: 'java',
    launchCwd: launchPath,
    targetExecutable: launchPath,
    launchArgs: [
      '-Xdebug',
      `-Xrunjdwp:transport=dt_socket,address=${attachHost}:${attachPort},server=y,suspend=y`,
      '-classpath',
      launchPath,
      commandLine,
      ...(launchInfo.runArgs || []),
    ],
  });
}

export async function javaDebugWaitForJdwpProcessStart(
  jvmSuspendArgs: string,
): Promise<void> {
  return new Promise(resolve => {
    const disposable = new UniversalDisposable();
    disposable.add(
      Observable.interval(1000)
        .mergeMap(async () => {
          const line = await _findJdwpProcess(jvmSuspendArgs);
          if (line != null) {
            disposable.dispose();
            resolve();
          }
        })
        .timeout(30000)
        .subscribe(),
    );
  });
}

export async function javaDebugWaitForJdwpProcessExit(
  jvmSuspendArgs: string,
): Promise<void> {
  return new Promise(resolve => {
    const disposable = new UniversalDisposable();
    let pidLine = null;
    disposable.add(
      Observable.interval(1000)
        .mergeMap(async () => {
          const line = await _findJdwpProcess(jvmSuspendArgs);
          if (line != null) {
            if (pidLine != null && pidLine !== line) {
              // The matching target process line has changed, so the process
              // we were watching is now gone.
              disposable.dispose();
              resolve();
            }
            pidLine = line;
          } else {
            disposable.dispose();
            resolve();
          }
        })
        .subscribe(),
    );
  });
}

async function _getJavaArgs(debug: boolean): Promise<Array<string>> {
  const baseJavaArgs = [
    '-classpath',
    await _getClassPath(),
    'com.facebook.nuclide.debugger.JavaDbg',
    '--vsp',
  ];
  const debugArgs = debug
    ? [
        '-Xdebug',
        '-Xrunjdwp:transport=dt_socket,address=127.0.0.1:' +
          (await getAvailableServerPort()).toString() +
          ',server=y,suspend=n',
      ]
    : [];
  return debugArgs.concat(baseJavaArgs);
}

async function _getClassPath(): Promise<string> {
  const serverJarPath = nuclideUri.join(
    __dirname,
    '..',
    'Build',
    'java_debugger_server.jar',
  );

  if (!(await fsPromise.exists(serverJarPath))) {
    throw new Error(
      `Could not locate the java debugger server jar: ${serverJarPath}. ` +
        'Please check your Nuclide installation.',
    );
  }

  // Determining JDK lib path varies by platform.
  let toolsJarPath;
  switch (os.platform()) {
    case 'win32':
      toolsJarPath = (process.env.JAVA_HOME || '') + '\\lib\\tools.jar';

      break;
    case 'linux': {
      // Find java
      const java = (await runCommand('which', ['java']).toPromise()).trim();
      const javaHome = await fsPromise.realpath(java);

      const matches = /(.*)\/java/.exec(javaHome);
      toolsJarPath = matches.length > 1 ? matches[1] + '/../lib/tools.jar' : '';
      break;
    }
    case 'darwin':
    default: {
      const javaHome = (await runCommand(
        '/usr/libexec/java_home',
      ).toPromise()).trim();
      toolsJarPath = javaHome + '/lib/tools.jar';

      break;
    }
  }
  if (!(await fsPromise.exists(toolsJarPath))) {
    throw new Error(
      `Could not locate required JDK tools jar: ${toolsJarPath}. Is the JDK installed?`,
    );
  }
  return nuclideUri.joinPathList([serverJarPath, toolsJarPath]);
}

async function _findJdwpProcess(jvmSuspendArgs: string): Promise<?string> {
  const commands = await runCommand(
    'ps',
    ['-eww', '-o', 'pid,args'],
    {},
  ).toPromise();

  const procs = commands
    .toString()
    .split('\n')
    .filter(line => line.includes(jvmSuspendArgs));
  const line = procs.length === 1 ? procs[0] : null;
  return line;
}
