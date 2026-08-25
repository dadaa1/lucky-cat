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

// 把 updateDate / createDate 统一转成可比较的数字（毫秒时间戳）。
// 支持：数字时间戳、数字字符串、以及 "YYYY-M-D H:M:S" 这类日期字符串；缺失或非法则视为 0。
const toTime = (v) => {
  if (v === '' || v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  const t = Date.parse(String(v).replace(' ', 'T'));
  return Number.isNaN(t) ? 0 : t;
};

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

// 按 updateDate 从新到旧（降序）排序；缺失 updateDate 时回退到 createDate
records.sort((a, b) => toTime(b.updateDate || b.createDate) - toTime(a.updateDate || a.createDate));

await writeFile(outFile, `${JSON.stringify(records, null, 2)}\n`);
console.log(`Wrote ${records.length} records to ${path.relative(root, outFile)}`);
