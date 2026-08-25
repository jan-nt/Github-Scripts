import { readFile, readdir } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';

const repositoryRoot = new URL('../', import.meta.url);
const rawUrlPrefix =
    'https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/';
const expectedAuthor = 'Jan Sinnadurai';
const expectedNamespace = 'https://nidushan.com';
const expectedHomepageUrl = 'https://nidushan.com';
const expectedSupportUrl = 'mailto:jas@nortronic.com';

const requiredSingleMetadata = [
    'name',
    'namespace',
    'version',
    'description',
    'author',
    'homepageURL',
    'supportURL',
    'updateURL',
    'downloadURL',
    'grant',
    'run-at',
    'noframes'
];

const secretPatterns = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    [
        'GitHub token',
        /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/
    ],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
    ['Google API key', /\bAIza[A-Za-z0-9_-]{30,}\b/],
    ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ['Stripe secret key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/],
    ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
    ['Bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i],
    ['credential-bearing URL', /https?:\/\/[^\s/@:]+:[^\s/@]+@/i],
    [
        'database connection string',
        /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s]+/i
    ]
];
const personalDataExamplePatterns = [
    ['formatted phone-like example', /(?<!\d)\d{3}\s+\d{2}\s+\d{3}(?!\d)/],
    ['license-plate-like example', /\b[A-Z]{2}[ -]\d{4,5}\b/]
];
const textFileExtensions = new Set([
    '.css',
    '.csv',
    '.env',
    '.html',
    '.ini',
    '.js',
    '.mjs',
    '.json',
    '.md',
    '.ps1',
    '.sh',
    '.toml',
    '.txt',
    '.tsv',
    '.yaml',
    '.yml'
]);
const extensionlessTextFiles = new Set([
    '.gitattributes',
    '.gitignore',
    'CODEOWNERS'
]);

function addError(errors, fileName, message) {
    errors.push(`${fileName}: ${message}`);
}

function parseMetadata(source, fileName, errors) {
    const block = source.match(
        /^\/\/ ==UserScript==\r?\n([\s\S]*?)^\/\/ ==\/UserScript==\s*$/m
    );

    if (!block || block.index !== 0) {
        addError(errors, fileName, 'missing a userscript metadata block at the start');
        return new Map();
    }

    const metadata = new Map();

    for (const line of block[1].split(/\r?\n/)) {
        const match = line.match(/^\/\/ @(\S+)(?:\s+(.*))?$/);
        if (!match) continue;

        const [, key, rawValue = ''] = match;
        const values = metadata.get(key) || [];
        values.push(rawValue.trim());
        metadata.set(key, values);
    }

    return metadata;
}

function getSingleMetadata(metadata, key, fileName, errors) {
    const values = metadata.get(key) || [];

    if (values.length !== 1) {
        addError(
            errors,
            fileName,
            `expected exactly one @${key} entry, found ${values.length}`
        );
        return '';
    }

    if (key !== 'noframes' && values[0] === '') {
        addError(errors, fileName, `@${key} must not be empty`);
    }

    return values[0];
}

function validateRequireUrl(value, fileName, errors) {
    let url;

    try {
        url = new URL(value);
    } catch {
        addError(errors, fileName, 'contains an invalid @require URL');
        return;
    }

    if (url.protocol !== 'https:') {
        addError(errors, fileName, '@require must use HTTPS');
    }

    const integrity = url.hash.slice(1);
    const sha256Pattern =
        /(?:^|[,;])sha256[-=](?:[A-Fa-f0-9]{64}|[A-Za-z0-9+/]{43}=)(?:$|[,;])/;

    if (!sha256Pattern.test(integrity)) {
        addError(errors, fileName, '@require must include a SHA-256 integrity hash');
    }

    if (/\b(?:latest|next|master|main)\b/i.test(url.pathname)) {
        addError(errors, fileName, '@require must use an immutable version');
    }
}

function validateSource(source, fileName, metadata, errors) {
    if (/\bconsole\s*\./.test(source)) {
        addError(errors, fileName, 'contains a console statement');
    }

    if (/\bdebugger\s*;?/.test(source)) {
        addError(errors, fileName, 'contains a debugger statement');
    }

    if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) {
        addError(errors, fileName, 'contains dynamic code execution');
    }

    for (const key of requiredSingleMetadata) {
        getSingleMetadata(metadata, key, fileName, errors);
    }

    const matches = metadata.get('match') || [];
    if (matches.length === 0) {
        addError(errors, fileName, 'must contain at least one @match entry');
    }

    for (const value of matches) {
        if (!value.startsWith('https://')) {
            addError(errors, fileName, 'all @match entries must use HTTPS');
        }

        const host = value.match(/^https:\/\/([^/]+)/)?.[1] || '';
        if (!host || host.includes('*')) {
            addError(
                errors,
                fileName,
                'all @match entries must use an exact HTTPS hostname'
            );
        }
    }

    const version = (metadata.get('version') || [''])[0];
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        addError(errors, fileName, '@version must use major.minor.patch');
    }

    const author = (metadata.get('author') || [''])[0];
    if (author !== expectedAuthor) {
        addError(errors, fileName, '@author does not match the project author');
    }

    const supportUrl = (metadata.get('supportURL') || [''])[0];
    if (supportUrl !== expectedSupportUrl) {
        addError(errors, fileName, '@supportURL does not match the project address');
    }

    const expectedRawUrl = rawUrlPrefix + encodeURIComponent(fileName);
    const updateUrl = (metadata.get('updateURL') || [''])[0];
    const downloadUrl = (metadata.get('downloadURL') || [''])[0];

    if (updateUrl !== expectedRawUrl) {
        addError(errors, fileName, '@updateURL does not match the script filename');
    }

    if (downloadUrl !== expectedRawUrl) {
        addError(errors, fileName, '@downloadURL does not match the script filename');
    }

    if ((metadata.get('grant') || [''])[0] !== 'none') {
        addError(errors, fileName, '@grant must remain none unless reviewed explicitly');
    }

    const runAt = (metadata.get('run-at') || [''])[0];
    if (!['document-start', 'document-body', 'document-end', 'document-idle'].includes(runAt)) {
        addError(errors, fileName, '@run-at contains an unsupported value');
    }

    if ((metadata.get('noframes') || ['unexpected value'])[0] !== '') {
        addError(errors, fileName, '@noframes must not have a value');
    }

    const namespace = (metadata.get('namespace') || [''])[0];
    const homepageUrl = (metadata.get('homepageURL') || [''])[0];

    if (namespace !== expectedNamespace) {
        addError(errors, fileName, '@namespace does not match the project URL');
    }

    if (homepageUrl !== expectedHomepageUrl) {
        addError(errors, fileName, '@homepageURL does not match the project URL');
    }

    for (const [key, value] of [
        ['namespace', namespace],
        ['homepageURL', homepageUrl]
    ]) {
        try {
            if (new URL(value).protocol !== 'https:') {
                throw new Error('HTTPS required');
            }
        } catch {
            addError(errors, fileName, `@${key} must be a valid HTTPS URL`);
        }
    }

    for (const value of metadata.get('require') || []) {
        validateRequireUrl(value, fileName, errors);
    }
}

async function collectRepositoryTextFiles(directory, relativeDirectory = '') {
    const directoryEntries = await readdir(directory, { withFileTypes: true });
    const files = [];

    for (const entry of directoryEntries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;

        const relativePath = relativeDirectory
            ? `${relativeDirectory}/${entry.name}`
            : entry.name;
        const url = new URL(relativePath, repositoryRoot);

        if (entry.isDirectory()) {
            files.push(...await collectRepositoryTextFiles(url, relativePath));
            continue;
        }

        const extension = entry.name.includes('.')
            ? entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
            : '';

        if (
            entry.isFile() &&
            (
                textFileExtensions.has(extension) ||
                extensionlessTextFiles.has(entry.name)
            )
        ) {
            files.push({ relativePath, url });
        }
    }

    return files;
}

function scanSensitiveContent(source, relativePath, errors) {
    for (const [label, pattern] of [
        ...secretPatterns,
        ...personalDataExamplePatterns
    ]) {
        if (pattern.test(source)) {
            addError(
                errors,
                relativePath,
                `contains a possible ${label}; value not printed`
            );
        }
    }
}

async function verifyRemoteRequire(value, fileName, errors) {
    try {
        const url = new URL(value);
        const integrity = url.hash.slice(1);
        const match = integrity.match(
            /(?:^|[,;])sha256[-=]([A-Fa-f0-9]{64}|[A-Za-z0-9+/]{43}=)(?:$|[,;])/
        );

        if (!match) return;

        const expected = /^[A-Fa-f0-9]{64}$/.test(match[1])
            ? Buffer.from(match[1], 'hex')
            : Buffer.from(match[1], 'base64');

        url.hash = '';

        const response = await fetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(20_000)
        });

        if (!response.ok) {
            addError(
                errors,
                fileName,
                `@require integrity download returned HTTP ${response.status}`
            );
            return;
        }

        const body = Buffer.from(await response.arrayBuffer());
        const actual = createHash('sha256').update(body).digest();

        if (
            expected.length !== actual.length ||
            !timingSafeEqual(expected, actual)
        ) {
            addError(errors, fileName, '@require SHA-256 integrity mismatch');
        }
    } catch (error) {
        addError(
            errors,
            fileName,
            `could not verify @require integrity (${error.name || 'network error'})`
        );
    }
}

const entries = await readdir(repositoryRoot, { withFileTypes: true });
const scriptFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.user.js'))
    .map(entry => entry.name)
    .sort();
const unexpectedJavaScriptFiles = entries
    .filter(
        entry =>
            entry.isFile() &&
            entry.name.endsWith('.js') &&
            !entry.name.endsWith('.user.js')
    )
    .map(entry => entry.name);

const errors = [];
const remoteRequires = [];

for (const { relativePath, url } of await collectRepositoryTextFiles(repositoryRoot)) {
    const source = await readFile(url, 'utf8');
    scanSensitiveContent(source, relativePath, errors);
}

if (scriptFiles.length === 0) {
    errors.push('Repository: no root userscript files found');
}

for (const fileName of unexpectedJavaScriptFiles) {
    addError(errors, fileName, 'root userscripts must end in .user.js');
}

const readme = await readFile(new URL('README.md', repositoryRoot), 'utf8');

for (const fileName of scriptFiles) {
    const source = await readFile(new URL(fileName, repositoryRoot), 'utf8');
    const metadata = parseMetadata(source, fileName, errors);

    validateSource(source, fileName, metadata, errors);

    for (const value of metadata.get('require') || []) {
        remoteRequires.push({ value, fileName });
    }

    const expectedRawUrl = rawUrlPrefix + encodeURIComponent(fileName);
    if (!readme.includes(`](${expectedRawUrl})`)) {
        addError(errors, fileName, 'README is missing its raw installation link');
    }
}

if (process.argv.includes('--verify-remote')) {
    for (const { value, fileName } of remoteRequires) {
        await verifyRemoteRequire(value, fileName, errors);
    }
}

if (errors.length > 0) {
    console.error('Userscript validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
} else {
    console.log(`Validated ${scriptFiles.length} userscripts.`);
}
