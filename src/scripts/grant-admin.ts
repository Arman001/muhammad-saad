/**
 * Grants the ADMIN role to an existing user.
 * Usage: pnpm admin:grant <email | auth sub>
 * The user must have called the API at least once (users are created on first request).
 */
import 'dotenv/config';
import { prisma } from '../shared/db/prisma.js';

async function main(): Promise<void> {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error('Usage: pnpm admin:grant <email | auth sub>');
    process.exitCode = 1;
    return;
  }

  const users = await prisma.user.findMany({
    where: { OR: [{ authSub: identifier }, { email: identifier }] },
  });
  if (users.length === 0) {
    console.error(`No user found for "${identifier}". Call the API once with that account first.`);
    process.exitCode = 1;
    return;
  }
  if (users.length > 1) {
    console.error(`"${identifier}" matches ${users.length} users. Use the auth sub instead.`);
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.update({ where: { id: users[0]!.id }, data: { role: 'ADMIN' } });
  console.log(`User ${user.authSub} (${user.id}) is now ADMIN.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
