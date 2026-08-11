import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const outFile = path.join(root, 'docs', 'data-index.json');

const cleanText = (markdown) =>
  markdown
    .replace(/^---[\s\S]*?---/, '')
    .replace(/\[toc\]/gi, '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[[^\]]+]\([^)]+\)/g, (match) => match.replace(/^\[|\]\([^)]+\)$/g, ''))
    .replace(/<[^>]+>/g, '')
    .replace(/[#>*_`~|[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractFrontMatter = (markdown) => {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  return Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => {
        const separator = line.indexOf(':');
        if (separator < 0) return null;
        const key = line.slice(0, separator).trim();
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '');
        return [key, value];
      })
      .filter(Boolean),
  );
};

const pickMarkdown = async (dir, meta) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);

  if (meta.main && markdownFiles.includes(meta.main)) return meta.main;
  const folderName = path.basename(dir);
  return markdownFiles.find((name) => name === `${folderName}.md`) || markdownFiles[0] || '';
};

const collectImages = async (dir) => {
  try {
    const images = await readdir(path.join(dir, 'images'), { withFileTypes: true });
    return images
      .filter((entry) => entry.isFile())
      .map((entry) => `images/${entry.name}`)
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  } catch {
    return [];
  }
};

const folders = (await readdir(dataDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

const records = [];

for (const folder of folders) {
  const itemDir = path.join(dataDir, folder);
  let meta = {};

  try {
    meta = JSON.parse(await readFile(path.join(itemDir, 'xiaoshujiang.json'), 'utf8'));
  } catch {
    meta = {};
  }

  const markdownFile = await pickMarkdown(itemDir, meta);
  const markdown = markdownFile ? await readFile(path.join(itemDir, markdownFile), 'utf8') : '';
  const frontMatter = extractFrontMatter(markdown);
  const images = await collectImages(itemDir);
  let comments = [];
  try {
    comments = JSON.parse(await readFile(path.join(itemDir, 'attachments', 'comments.json'), 'utf8'));
  } catch {
    comments = [];
  }
  const coverMatch = markdown.match(/cover:\s*['"]?!\[cover]\(([^)]+)\)['"]?/);
  const cover = coverMatch?.[1] || images.find((image) => image.includes('xsjCover')) || images[0] || '';
  const title = meta.title || frontMatter.title || folder;
  const summary = cleanText(markdown).slice(0, 180);

  records.push({
    id: encodeURIComponent(folder),
    folder,
    title,
    author: title.match(/^\(([^)]+)\)/)?.[1] || '',
    category: frontMatter.category || '',
    slug: meta.slug || frontMatter.slug || '',
    createDate: frontMatter.createDate || '',
    updateDate: meta.updateDate || '',
    markdown: markdownFile,
    cover,
    images,
    imageCount: images.length,
    commentCount: comments.reduce((sum, comment) => sum + 1 + (comment.child_comments?.length || 0), 0),
    commentsPath: comments.length ? 'attachments/comments.json' : '',
    summary,
  });
}

await writeFile(outFile, `${JSON.stringify(records, null, 2)}\n`);
console.log(`Wrote ${records.length} records to ${path.relative(root, outFile)}`);
