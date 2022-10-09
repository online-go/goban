import { GoMath } from "../GoMath";
import { JGOFNumericPlayerColor } from "../JGOF";

type Testcase = {
    height: number;
    width: number;
    board: Array<Array<JGOFNumericPlayerColor>>;
    id: string;
};

const TEST_BOARDS = [
    {
        height: 7,
        width: 7,
        board: [
            [0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0],
        ],
        id: ".B3",
    },
] as Array<Testcase>;

test("Position IDs", () => {
    TEST_BOARDS.forEach((testcase: Testcase) => {
        expect(GoMath.positionId(testcase.board, testcase.height, testcase.width)).toEqual(
            testcase.id,
        );
    });
});
