import { readFileSync } from 'node:fs';
const actualNow = Date.now;
Date.now = () => actualNow() + Number(readFileSync(process.env.CYBERCARE_TEST_CLOCK, 'utf8'));
