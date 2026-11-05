// Accounts from the command line; sign-up is closed in the app.
//   npm run account -- list
//   npm run account -- create <email> [--name "Name"]
//   npm run account -- password <email>
//   npm run account -- rename <email> [--email new@example.com] [--name "New name"]
//   npm run account -- delete <email> --yes
// The password is asked twice without echo; piped in (one line) when not run from a terminal.

import { parseArgs } from 'node:util';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../accounts/passwords.ts';
import { findLogin, listAccounts, setPasswordHash, updateAccount } from '../accounts/store.ts';
import { Tenancy } from '../accounts/tenancy.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { name: { type: 'string' }, email: { type: 'string' }, yes: { type: 'boolean', default: false } },
});
const [command, email] = positionals;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Reads a line without echoing it (raw mode); from a pipe, the first line of stdin. */
function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => (data += chunk));
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0] ?? ''));
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let value = '';
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          process.exit(130);
        }
        value = ch === '\u007f' || ch === '\b' ? value.slice(0, -1) : value + ch;
      }
    };
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
    };
    const finish = (): void => {
      cleanup();
      process.stdout.write('\n');
      resolve(value);
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function newPassword(): Promise<string> {
  const password = await readSecret('Password: ');
  if (password.length < MIN_PASSWORD_LENGTH) fail(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (process.stdin.isTTY && (await readSecret('Repeat it: ')) !== password) fail('The two passwords differ.');
  return hashPassword(password);
}

const tenancy = Tenancy.open();
try {
  const account = email ? findLogin(tenancy.system, email)?.account : undefined;
  switch (command) {
    case 'list':
      for (const a of listAccounts(tenancy.system)) {
        const login = a.kind === 'user' ? `${a.email}${a.hasPassword ? '' : '  (no password yet)'}` : a.kind === 'sandbox' ? `expires ${a.expiresAt}` : 'demo template';
        console.log(`${a.kind.padEnd(8)} ${a.name.padEnd(16)} ${login}`);
      }
      break;
    case 'create': {
      if (!email || !email.includes('@')) fail('Usage: npm run account -- create <email> [--name "Name"]');
      if (account) fail(`${email} already has an account.`);
      const created = tenancy.createUser({ email, name: values.name ?? email.split('@')[0]!, passwordHash: await newPassword() });
      console.log(`Created ${created.email}.`);
      break;
    }
    case 'password':
      if (!account) fail(`No account for ${email ?? '(missing email)'}.`);
      setPasswordHash(tenancy.system, account.id, await newPassword());
      console.log(`Password set for ${account.email}; its other sessions are signed out.`);
      break;
    case 'rename':
      if (!account) fail(`No account for ${email ?? '(missing email)'}.`);
      if (values.email && findLogin(tenancy.system, values.email)) fail(`${values.email} already has an account.`);
      updateAccount(tenancy.system, account.id, { ...(values.email && { email: values.email }), ...(values.name && { name: values.name }) });
      console.log('Updated.');
      break;
    case 'delete':
      if (!account) fail(`No account for ${email ?? '(missing email)'}.`);
      if (!values.yes) fail(`This deletes ${account.email} and all its data. Run again with --yes.`);
      if (tenancy.removeAccount(account.id)) console.log(`Deleted ${account.email}.`);
      else console.log(`Deleted ${account.email}; the running server still has its file open and removes it within the hour.`);
      break;
    default:
      fail('Commands: list · create <email> · password <email> · rename <email> · delete <email> --yes');
  }
} finally {
  tenancy.close();
}
