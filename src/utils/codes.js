const crypto = require('crypto');


function rand6() {
// 6 ตัวอ่านง่าย (Base64URL → A-Z a-z 0-9 - _ แต่เราตัดให้เป็นตัวพิมพ์ใหญ่/ตัวเลข)
return crypto.randomBytes(4).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
}


function genCode(prefix, extra = '') {
const ex = extra ? `-${extra}` : '';
return `${prefix}${ex}-${rand6()}`; // ตัวอย่าง PL-9X2Q7A หรือ TM-BG--F3R0C2
}


module.exports = { genCode };