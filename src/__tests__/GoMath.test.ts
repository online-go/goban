import { GoMath } from "../GoMath";

test("encodeMoveToArray", () => {
    expect(GoMath.encodeMoveToArray({ x: 1, y: 1 })).toEqual([1, 1, -1]);
});
