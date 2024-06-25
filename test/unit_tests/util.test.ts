/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
import { escapeSGFText, newlines_to_spaces } from "engine";
import * as AdHoc from "engine/formats/AdHocFormat";

// String.raw`...` is the real string
// (without js interpreting \, of which we have a ton)

test("escapeSGFText duplicates slashes", () => {
    expect(escapeSGFText(String.raw`f\*\a`)).toBe(String.raw`f\\*\\a`);
});

test("escapeSGFText escapes closing square bracket", () => {
    expect(escapeSGFText(String.raw`{}[]()`)).toBe(String.raw`{}[\]()`);
});

test("escapeSGFText escapes test string", () => {
    expect(escapeSGFText(String.raw`test [] test 2 \[\]`)).toBe(
        String.raw`test [\] test 2 \\[\\\]`,
    );
});

test("escapeSGFText changes non newline/carriage-return whitespace to spaces", () => {
    expect(escapeSGFText("\thi\n\r my\u00a0\ffriend\n")).toBe(" hi\n\r my  friend\n");
});

test("escapeSGFText leaves other things be", () => {
    const ugly = "[@\r\nblah:#$\n%^&*()ěšč  řžý:áí";
    expect(escapeSGFText(ugly)).toBe(ugly);
});

test("escapeSGFText handles colon iff need be", () => {
    expect(escapeSGFText("AC:AE")).toBe("AC:AE");
    expect(escapeSGFText("AC:AE", true)).toBe(String.raw`AC\:AE`);
});

test("newlines_to_spaces replaces what it should", () => {
    expect(newlines_to_spaces("hello\nlucky\r\nboy")).toBe("hello lucky  boy");
});

test("AdHoc is defined", () => {
    expect(AdHoc).toBeDefined();
});
