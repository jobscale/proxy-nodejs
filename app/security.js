import fs from 'fs';

const privateIp = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
];

const whitelist = [
  ...privateIp,
  ...fs.readFileSync('acl/white-list').toString().split('\n').filter(v => v.trim()),
];

const denyList = [
  ...fs.readFileSync('acl/deny-domain').toString()
  .split('\n').filter(v => v.trim()),
  ...fs.readFileSync('acl/deny-regex').toString()
  .split('\n').filter(v => v.trim()).map(exp => new RegExp(exp)),
];

export const denyDomain = host => denyList.some(exp => host.match(exp));

// IPv4 → 32bit 整数
const ipToInt = ip => ip.split('.').reduce((acc, v) => acc << 8 | v, 0) >>> 0;

// CIDR 判定
const inCIDR = (ip, base, mask) => {
  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base);
  const maskBits = 32 - mask;
  return ipInt >>> maskBits === baseInt >>> maskBits;
};

export const allowedIp = ip => whitelist.some(cidr => inCIDR(ip, ...cidr.split('/')));
