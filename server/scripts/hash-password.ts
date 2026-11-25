import bcrypt from 'bcryptjs';
const pw = process.argv[2];
if (!pw || pw.length < 4) { console.error('Usage: npm run hash-password -- "YourPassword"'); process.exit(1); }
if (pw.length < 10) console.error('WARNING: short passwords are easy to guess. Login is rate-limited, but 10+ characters is strongly recommended.');
console.log(bcrypt.hashSync(pw, 12));
