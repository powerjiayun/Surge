const { fetch } = require('undici');
const tar = require('tar');
const fs = require('fs');
const fse = require('fs-extra');
const { join, resolve } = require('path');
const { tmpdir } = require('os');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { readFileByLine } = require('./lib/fetch-remote-text-by-line');
const { isCI } = require('ci-info');
const { task, traceAsync } = require('./lib/trace-runner');

const fileExists = (path) => {
  return fs.promises.access(path, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false);
};

const downloadPreviousBuild = task(__filename, async () => {
  const filesList = ['Clash', 'List'];

  let allFileExists = true;

  if (isCI) {
    allFileExists = false;
  } else {
    for await (const line of readFileByLine(resolve(__dirname, '../.gitignore'))) {
      if (
        (
        // line.startsWith('List/')
          line.startsWith('Modules/')
        ) && !line.endsWith('/')
      ) {
        allFileExists = fs.existsSync(join(__dirname, '..', line));
        filesList.push(line);

        if (!allFileExists) {
          console.log(`File not exists: ${line}`);
          break;
        }
      }
    }
  }

  if (allFileExists) {
    console.log('All files exists, skip download.');
    return;
  }

  const extractedPath = join(tmpdir(), `sukka-surge-last-build-extracted-${Date.now()}`);

  await traceAsync(
    'Download and extract previous build',
    () => Promise.all([
      fetch('https://codeload.github.com/sukkaw/surge/tar.gz/gh-pages'),
      fse.ensureDir(extractedPath)
    ]).then(([resp]) => pipeline(
      Readable.fromWeb(resp.body),
      tar.x({
        cwd: extractedPath,
        filter(p) {
          const dir = p.split('/')[1];
          return dir === 'List' || dir === 'Modules' || dir === 'Clash';
        }
      })
    ))
  );

  console.log('Files list:', filesList);

  await Promise.all(filesList.map(async p => {
    const src = join(extractedPath, 'Surge-gh-pages', p);
    if (await fileExists(src)) {
      const dst = join(__dirname, '..', p);
      console.log('Copy', { src, dst });
      return fse.copy(
        src,
        join(__dirname, '..', p),
        { overwrite: true }
      );
    }

    console.log('File not exists:', src);
  }));

  await fs.promises.unlink(extractedPath).catch(() => { });
});

const downloadPublicSuffixList = task(__filename, async () => {
  const publicSuffixDir = resolve(__dirname, '../node_modules/.cache');
  const publicSuffixPath = join(publicSuffixDir, 'public_suffix_list_dat.txt');

  console.log('Download public suffix list.');

  const [resp] = await Promise.all([
    fetch('https://publicsuffix.org/list/public_suffix_list.dat'),
    fse.ensureDir(publicSuffixDir)
  ]);

  await pipeline(
    Readable.fromWeb(resp.body),
    fs.createWriteStream(publicSuffixPath)
  );
}, 'download-publicsuffixlist');

module.exports.downloadPreviousBuild = downloadPreviousBuild;
module.exports.downloadPublicSuffixList = downloadPublicSuffixList;

if (require.main === module) {
  Promise.all([
    downloadPreviousBuild(),
    downloadPublicSuffixList()
  ]);
}
