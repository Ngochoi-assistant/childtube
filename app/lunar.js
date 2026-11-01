// Lịch âm Việt Nam (múi giờ +7) theo thuật toán của Hồ Ngọc Đức: đổi dương ↔ âm, can chi, tiết khí, giờ hoàng đạo, ngày lễ.
// ES5 thuần (chạy trên TV Tizen 6 / Chromium 76). Dùng chung cho TV (Màn hình chính) và app ChildTube: giữ hai bản giống nhau.
var Lunar = (function () {
  'use strict';
  var PI = Math.PI, TZ = 7, INT = Math.floor;

  function jdFromDate(dd, mm, yy) {
    var a = INT((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
    var jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
    if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
    return jd;
  }
  function jdToDate(jd) {
    var a, b, c;
    if (jd > 2299160) { a = jd + 32044; b = INT((4 * a + 3) / 146097); c = a - INT((b * 146097) / 4); }
    else { b = 0; c = jd + 32082; }
    var d = INT((4 * c + 3) / 1461), e = c - INT((1461 * d) / 4), m = INT((5 * e + 2) / 153);
    return [e - INT((153 * m + 2) / 5) + 1, m + 3 - 12 * INT(m / 10), b * 100 + d - 4800 + INT(m / 10)];
  }
  function newMoon(k) {
    var T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
    var jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
    jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    var M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
    var Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
    var F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    var C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
    C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr) - 0.0004 * Math.sin(dr * 3 * Mpr);
    C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr)) - 0.0074 * Math.sin(dr * (M - Mpr));
    C1 = C1 + 0.0004 * Math.sin(dr * (2 * F + M)) - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
    C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
    var dt = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
    return jd1 + C1 - dt;
  }
  function sunLongitude(jdn) {             // radian, 0..2π
    var T = (jdn - 2451545.0) / 36525, T2 = T * T, dr = PI / 180;
    var M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
    var L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    var DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M) + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
    var L = (L0 + DL) * dr;
    return L - PI * 2 * INT(L / (PI * 2));
  }
  function sunSector(dayNumber) { return INT(sunLongitude(dayNumber - 0.5 - TZ / 24) / PI * 6); }
  function newMoonDay(k) { return INT(newMoon(k) + 0.5 + TZ / 24); }
  function month11(yy) {
    var k = INT((jdFromDate(31, 12, yy) - 2415021) / 29.530588853), nm = newMoonDay(k);
    return sunSector(nm) >= 9 ? newMoonDay(k - 1) : nm;
  }
  function leapOffset(a11) {
    var k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5), last, i = 1, arc = sunSector(newMoonDay(k + i));
    do { last = arc; i++; arc = sunSector(newMoonDay(k + i)); } while (arc !== last && i < 14);
    return i - 1;
  }

  // Dương → âm: {d, m, y, leap, jd}
  function toLunar(dd, mm, yy) {
    var dayNumber = jdFromDate(dd, mm, yy), k = INT((dayNumber - 2415021.076998695) / 29.530588853);
    var start = newMoonDay(k + 1);
    if (start > dayNumber) start = newMoonDay(k);
    var a11 = month11(yy), b11 = a11, ly;
    if (a11 >= start) { ly = yy; a11 = month11(yy - 1); } else { ly = yy + 1; b11 = month11(yy + 1); }
    var diff = INT((start - a11) / 29), leap = 0, lm = diff + 11;
    if (b11 - a11 > 365) {
      var lo = leapOffset(a11);
      if (diff >= lo) { lm = diff + 10; if (diff === lo) leap = 1; }
    }
    if (lm > 12) lm -= 12;
    if (lm >= 11 && diff < 4) ly -= 1;
    return { d: dayNumber - start + 1, m: lm, y: ly, leap: leap, jd: dayNumber };
  }
  // Âm → dương: [d, m, y] (tháng nhuận không có trong năm đó: null)
  function toSolar(ld, lm, ly, leap) {
    var a11, b11;
    if (lm < 11) { a11 = month11(ly - 1); b11 = month11(ly); } else { a11 = month11(ly); b11 = month11(ly + 1); }
    var k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853), off = lm - 11;
    if (off < 0) off += 12;
    if (b11 - a11 > 365) {
      var lo = leapOffset(a11), leapMonth = lo - 2;
      if (leapMonth < 0) leapMonth += 12;
      if (leap && lm !== leapMonth) return null;
      if (leap || off >= lo) off += 1;
    } else if (leap) return null;
    return jdToDate(newMoonDay(k + off) + ld - 1);
  }
  // Số ngày của tháng âm (29 hoặc 30)
  function monthLength(lm, ly, leap) {
    var a = toSolar(1, lm, ly, leap);
    if (!a) return 30;
    var j = jdFromDate(a[0], a[1], a[2]), n = toLunar.apply(null, jdToDate(j + 29));
    return n.d === 30 ? 30 : 29;
  }

  var CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
  var CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
  var CON = ['Chuột', 'Trâu', 'Hổ', 'Mèo', 'Rồng', 'Rắn', 'Ngựa', 'Dê', 'Khỉ', 'Gà', 'Chó', 'Lợn'];
  var TIETKHI = ['Xuân phân', 'Thanh minh', 'Cốc vũ', 'Lập hạ', 'Tiểu mãn', 'Mang chủng', 'Hạ chí', 'Tiểu thử', 'Đại thử', 'Lập thu', 'Xử thử', 'Bạch lộ',
    'Thu phân', 'Hàn lộ', 'Sương giáng', 'Lập đông', 'Tiểu tuyết', 'Đại tuyết', 'Đông chí', 'Tiểu hàn', 'Đại hàn', 'Lập xuân', 'Vũ thủy', 'Kinh trập'];
  var GIO_HD = ['110100101100', '001101001011', '110011010010', '101100110100', '001011001101', '010010110011'];
  var THANG = ['Giêng', 'Hai', 'Ba', 'Tư', 'Năm', 'Sáu', 'Bảy', 'Tám', 'Chín', 'Mười', 'Một', 'Chạp'];

  function yearName(ly) { return CAN[(ly + 6) % 10] + ' ' + CHI[(ly + 8) % 12]; }
  function dayName(jd) { return CAN[(jd + 9) % 10] + ' ' + CHI[(jd + 1) % 12]; }
  function monthName(lm, ly) { return CAN[(ly * 12 + lm + 3) % 10] + ' ' + CHI[(lm + 1) % 12]; }
  function solarTerm(jd) { return TIETKHI[INT(sunLongitude(jd + 0.5 - TZ / 24) / PI * 12)]; }
  function goodHours(jd) {
    var bits = GIO_HD[((jd + 1) % 12) % 6], out = [];
    for (var i = 0; i < 12; i++) if (bits.charAt(i) === '1') out.push({ chi: CHI[i], from: (i * 2 + 23) % 24, to: (i * 2 + 1) % 24 });
    return out;
  }
  function lunarMonthLabel(lm, leap) { return 'tháng ' + THANG[lm - 1] + (leap ? ' (nhuận)' : ''); }

  // Ngày lễ: dương lịch [tháng, ngày, tên, nghỉ?], âm lịch [tháng, ngày, tên, nghỉ?]
  var SOLAR_HOL = [[1, 1, 'Tết Dương lịch', 1], [2, 3, 'Thành lập Đảng CSVN', 0], [2, 14, 'Lễ Tình nhân', 0], [3, 8, 'Quốc tế Phụ nữ', 0], [3, 26, 'Thành lập Đoàn TNCS', 0],
    [4, 30, 'Giải phóng miền Nam', 1], [5, 1, 'Quốc tế Lao động', 1], [5, 19, 'Ngày sinh Bác Hồ', 0], [6, 1, 'Quốc tế Thiếu nhi', 0], [6, 28, 'Ngày Gia đình Việt Nam', 0],
    [7, 27, 'Thương binh Liệt sĩ', 0], [8, 19, 'Cách mạng tháng Tám', 0], [9, 2, 'Quốc khánh', 1], [10, 10, 'Giải phóng Thủ đô', 0], [10, 20, 'Phụ nữ Việt Nam', 0],
    [11, 20, 'Nhà giáo Việt Nam', 0], [12, 22, 'Quân đội Nhân dân', 0], [12, 24, 'Đêm Giáng sinh', 0], [12, 25, 'Giáng sinh', 0]];
  var LUNAR_HOL = [[1, 1, 'Tết Nguyên Đán', 1], [1, 2, 'Mùng 2 Tết', 1], [1, 3, 'Mùng 3 Tết', 1], [1, 15, 'Rằm tháng Giêng', 0], [3, 3, 'Tết Hàn thực', 0],
    [3, 10, 'Giỗ Tổ Hùng Vương', 1], [4, 15, 'Lễ Phật Đản', 0], [5, 5, 'Tết Đoan Ngọ', 0], [7, 15, 'Lễ Vu Lan', 0], [8, 15, 'Tết Trung Thu', 0],
    [10, 10, 'Tết Song Thập', 0], [12, 23, 'Ông Công Ông Táo', 0]];

  // Mọi thông tin của một ngày dương lịch
  function info(dd, mm, yy) {
    var l = toLunar(dd, mm, yy), hol = [], i;
    for (i = 0; i < SOLAR_HOL.length; i++) if (SOLAR_HOL[i][0] === mm && SOLAR_HOL[i][1] === dd) hol.push({ name: SOLAR_HOL[i][2], off: !!SOLAR_HOL[i][3], lunar: false });
    if (!l.leap) for (i = 0; i < LUNAR_HOL.length; i++) if (LUNAR_HOL[i][0] === l.m && LUNAR_HOL[i][1] === l.d) hol.push({ name: LUNAR_HOL[i][2], off: !!LUNAR_HOL[i][3], lunar: true });
    if (l.m === 12 && l.d === monthLength(12, l.y, 0) && !l.leap) hol.push({ name: 'Giao thừa', off: true, lunar: true });
    return {
      d: dd, m: mm, y: yy, jd: l.jd, wd: new Date(yy, mm - 1, dd).getDay(),
      ld: l.d, lm: l.m, ly: l.y, leap: l.leap,
      yearName: yearName(l.y), animal: CON[(l.y + 8) % 12], monthName: monthName(l.m, l.y), dayName: dayName(l.jd),
      monthLabel: lunarMonthLabel(l.m, l.leap), term: solarTerm(l.jd), hours: goodHours(l.jd),
      firstOrFull: l.d === 1 ? 'Mùng 1' : l.d === 15 ? 'Rằm' : '', holidays: hol
    };
  }

  // Lần tới (từ ngày `from`, tính cả hôm nay) của một ngày lặp hằng năm. ev = {cal: 'lunar'|'solar', m, d}
  // Trả về {d, m, y, days} (days = còn bao nhiêu ngày). Ngày 30 âm mà tháng đó chỉ có 29 ngày: lấy ngày 29.
  function nextOccurrence(ev, from) {
    from = from || new Date();
    var f0 = jdFromDate(from.getDate(), from.getMonth() + 1, from.getFullYear()), y0 = from.getFullYear();
    for (var k = -1; k <= 2; k++) {
      var s;
      if (ev.cal === 'lunar') {
        var ly = y0 + k, d = ev.d;
        if (d === 30 && monthLength(ev.m, ly, 0) < 30) d = 29;
        s = toSolar(d, ev.m, ly, 0);
      } else {
        var yy = y0 + k, dd = ev.d;
        if (ev.m === 2 && dd === 29 && !(yy % 4 === 0 && (yy % 100 !== 0 || yy % 400 === 0))) dd = 28;
        s = [dd, ev.m, yy];
      }
      if (!s) continue;
      var j = jdFromDate(s[0], s[1], s[2]);
      if (j >= f0) return { d: s[0], m: s[1], y: s[2], days: j - f0 };
    }
    return null;
  }

  return { toLunar: toLunar, toSolar: toSolar, info: info, nextOccurrence: nextOccurrence, monthLength: monthLength,
    jdFromDate: jdFromDate, jdToDate: jdToDate, yearName: yearName, CHI: CHI, CAN: CAN, THANG: THANG, lunarMonthLabel: lunarMonthLabel,
    SOLAR_HOL: SOLAR_HOL, LUNAR_HOL: LUNAR_HOL };
})();
if (typeof module !== 'undefined') module.exports = Lunar;
