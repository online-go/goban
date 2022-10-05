import { escapeSGFText } from "../Misc";

test('escapeSGFText duplicates slashes', () => {
  expect(escapeSGFText("f\\*\\a")).toBe("f\\\\*\\\\a");
});

test('escapeSGFText escapes closing square bracket', () => {
  expect(escapeSGFText("{}[]()")).toBe("{}[\\]()");
});

test('escapeSGFText escapes test string', () => {
  expect(escapeSGFText("test [] test 2 \\[\\]")).toBe("test [\\] test 2 \\\\[\\\\\\]");
});

test('escapeSGFText leaves other things be', () => {
  var ugly = "[@#$%^&*()ěščřžýáí";
  expect(escapeSGFText(ugly)).toBe(ugly);
});
