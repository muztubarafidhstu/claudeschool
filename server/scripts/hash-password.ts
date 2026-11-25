import bcrypt from 'bcryptjs';
const pw = process.argv[2];
if (!pw || pw.length < 10) { console.error('Usage: npm run hash-password -- "AtLeast10Chars"'); process.exit(1); }
console.log(bcrypt.hashSync(pw, 12));
