import {Repository, Commit} from 'nodegit';
import path from 'path';
import elasticsearch from 'elasticsearch';
import program from 'commander';

let actionWasRun = false;

program
  .usage('[options] <commit...>')
  .description('Updates elasticsearch database with current Git history')
  .option('-r, --repo [path]', 'Path to working copy of a Git repository',
    (pathToRepo) => path.resolve(pathToRepo),
    '.'
  )
  .arguments('<commits...>')
  .action((commitIds, options) => {
    const client = new elasticsearch.Client({
      host: 'localhost:9200',
      log: 'trace'
    });
    let indexedCommits = [];
    let hunkId = 0;
    getDiffs(options.repo, commitIds, (data) => {
      // commit
      if (indexedCommits.indexOf(data.commit) === -1) {
        client.index({
          index: 'git',
          type: 'commit',
          id: data.commit,
          body: {
            sha: data.commit
          },
        });
        indexedCommits.push(data.commit);
      }

      // hunk
      client.index({
        index: 'git',
        type: 'hunk',
        id: hunkId++,
        body: data,
      });
    });
    actionWasRun = true;
  });

async function getDiffs(pathToRepo, commitIds, onData) {
  const repo = await Repository.open(pathToRepo);
  commitIds.map(async (commitId) => {
    console.log('Showing', commitId, commitIds.length);
    const commit = await Commit.lookup(repo, commitId);
    const diffs = await commit.getDiff();
    diffs.map(async (diff) => {
      const patches = await diff.patches();
      patches.map(async (patch) => {
        const hunks = await patch.hunks();
        hunks.map(async (hunk, index) => {
          const lines = await hunk.lines();
          const data = {
            hunkId: [commitId, index],
            commit: commit.sha(),
            isAdded: patch.isAdded(),
            isDeleted: patch.isDeleted(),
            isModified: patch.isModified(),
            context: hunk.header(),
            path: patch.newFile().path(),
            content: lines.map((line) => line.content()).join('')
          };
          onData(data);
        });
      });
    });
  });
}

program.parse(process.argv);
actionWasRun || program.help();
