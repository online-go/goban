/**
 * An attempt at territory scoring in Go with seki detection.
 * See https://github.com/lightvector/goscorer
 * Original Author: lightvector
 * Released under MIT license (https://github.com/lightvector/goscorer/blob/main/LICENSE.txt)
 */

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

/**
 * Indicates how a given location on the board should be scored for territory, along with other metadata.
 * isTerritoryFor is the primary field, indicating the territory (EMPTY / BLACK / WHITE) at each location.
 * See the Python version of this code for more detailed documentation on the fields of this class.
 */
class LocScore {
    constructor() {
        this.isTerritoryFor = EMPTY;
        this.belongsToSekiGroup = EMPTY;
        this.isFalseEye = false;
        this.isUnscorableFalseEye = false;
        this.isDame = false;
        this.eyeValue = 0;
    }
}

/**
 * @param {color[][]} stones - BLACK or WHITE or EMPTY indicating the stones on the board.
 * @param {bool[][]} markedDead - true if the location has a stone marked as dead, and false otherwise.
 * @param {float} blackPointsFromCaptures - points to add to black's score due to captures
 * @param {float} whitePointsFromCaptures - points to add to white's score due to captures
 * @param {float} komi - points to add to white's score due to komi
 * @param {bool} [scoreFalseEyes=false] - defaults to false, if set to true will score territory in false eyes even if
      is_unscorable_false_eye is true.
 * @return { {black:finalBlackScore,white:finalWhiteScore} }
 */
function finalTerritoryScore(
    stones,
    markedDead,
    blackPointsFromCaptures,
    whitePointsFromCaptures,
    komi,
    scoreFalseEyes = false
) {
    const scoring = territoryScoring(stones,markedDead,scoreFalseEyes);

    const ysize = stones.length;
    const xsize = stones[0].length;
    let finalBlackScore = 0;
    let finalWhiteScore = 0;
    for(let y = 0; y<ysize; y++) {
        for(let x = 0; x<xsize; x++) {
            if(scoring[y][x].isTerritoryFor == BLACK)
                finalBlackScore += 1;
            else if(scoring[y][x].isTerritoryFor == WHITE)
                finalWhiteScore += 1;

            if(stones[y][x] == BLACK && markedDead[y][x])
                finalWhiteScore += 1;
            else if(stones[y][x] == WHITE && markedDead[y][x])
                finalBlackScore += 1;
        }
    }
    finalBlackScore += blackPointsFromCaptures;
    finalWhiteScore += whitePointsFromCaptures;
    finalWhiteScore += komi;
    return {black:finalBlackScore,white:finalWhiteScore};
}

/**
 * @param {color[][]} stones - BLACK or WHITE or EMPTY indicating the stones on the board.
 * @param {bool[][]} markedDead - true if the location has a stone marked as dead, and false otherwise.
 * @param {float} komi - points to add to white's score due to komi
 * @return { {black:finalBlackScore,white:finalWhiteScore} }
 */
function finalAreaScore(
    stones,
    markedDead,
    komi,
) {
    const scoring = areaScoring(stones,markedDead);

    const ysize = stones.length;
    const xsize = stones[0].length;
    let finalBlackScore = 0;
    let finalWhiteScore = 0;
    for(let y = 0; y<ysize; y++) {
        for(let x = 0; x<xsize; x++) {
            if(scoring[y][x] == BLACK)
                finalBlackScore += 1;
            else if(scoring[y][x] == WHITE)
                finalWhiteScore += 1;
        }
    }
    finalWhiteScore += komi;
    return {black:finalBlackScore,white:finalWhiteScore};
}

/**
 * @param {color[][]} stones - BLACK or WHITE or EMPTY indicating the stones on the board.
 * @param {bool[][]} markedDead - true if the location has a stone marked as dead, and false otherwise.
 * @param {bool} [scoreFalseEyes=false] - defaults to false, if set to true will score territory in false eyes even if
      is_unscorable_false_eye is true.
 * @return {LocScore[][]}
 */
function territoryScoring(
    stones,
    markedDead,
    scoreFalseEyes = false
) {
    const ysize = stones.length;
    const xsize = stones[0].length;

    stones.forEach(row => {
        if(row.length !== xsize)
            throw new Error(`Not all rows in stones are the same length ${xsize}`);
        row.forEach(value => {
            if(value !== EMPTY && value !== BLACK && value !== WHITE)
                throw new Error("Unexpected value in stones " + value);
        });
    });

    if(markedDead.length !== ysize)
        throw new Error(`markedDead is not the same length as stones ${ysize}`);

    markedDead.forEach(row => {
        if(row.length !== xsize)
            throw new Error(`Not all rows in markedDead are the same length as stones ${xsize}`);
    });

    const connectionBlocks = makeArray(ysize, xsize, EMPTY);
    markConnectionBlocks(ysize, xsize, stones, markedDead, connectionBlocks);

    // console.log("CONNECTIONBLOCKS");
    // print2d(connectionBlocks, (s) =>
    //         ".xo"[s]
    //        );

    const strictReachesBlack = makeArray(ysize, xsize, false);
    const strictReachesWhite = makeArray(ysize, xsize, false);
    markReachability(ysize, xsize, stones, markedDead, null, strictReachesBlack, strictReachesWhite);

    const reachesBlack = makeArray(ysize, xsize, false);
    const reachesWhite = makeArray(ysize, xsize, false);
    markReachability(ysize, xsize, stones, markedDead, connectionBlocks, reachesBlack, reachesWhite);

    const regionIds = makeArray(ysize, xsize, -1);
    const regionInfosById = {};
    markRegions(ysize, xsize, stones, markedDead, connectionBlocks, reachesBlack, reachesWhite, regionIds, regionInfosById);

    // console.log("REGIONIDS");
    // print2d(regionIds, (s) =>
    //         ".0123456789abcdefghijklmnopqrstuvwxyz"[s+1]
    //        );

    const chainIds = makeArray(ysize, xsize, -1);
    const chainInfosById = {};
    markChains(ysize, xsize, stones, markedDead, regionIds, chainIds, chainInfosById);

    const macrochainIds = makeArray(ysize, xsize, -1);
    const macrochainInfosById = {};
    markMacrochains(ysize, xsize, stones, markedDead, connectionBlocks, regionIds, regionInfosById, chainIds, chainInfosById, macrochainIds, macrochainInfosById);

    // console.log("MACROCHAINS");
    // print2d(macrochainIds, (s) =>
    //         ".0123456789abcdefghijklmnopqrstuvwxyz"[s+1]
    //        );

    const eyeIds = makeArray(ysize, xsize, -1);
    const eyeInfosById = {};
    markPotentialEyes(ysize, xsize, stones, markedDead, strictReachesBlack, strictReachesWhite, regionIds, regionInfosById, macrochainIds, macrochainInfosById, eyeIds, eyeInfosById);

    // console.log("EYE IDS");
    // print2d(eyeIds, (s) =>
    //         ".0123456789abcdefghijklmnopqrstuvwxyz"[s+1]
    //        );

    const isFalseEyePoint = makeArray(ysize, xsize, false);
    markFalseEyePoints(ysize, xsize, regionIds, macrochainIds, macrochainInfosById, eyeInfosById, isFalseEyePoint);

    markEyeValues(ysize, xsize, stones, markedDead, regionIds, regionInfosById, chainIds, chainInfosById, isFalseEyePoint, eyeIds, eyeInfosById);

    const isUnscorableFalseEyePoint = makeArray(ysize, xsize, false);
    markFalseEyePoints(ysize, xsize, regionIds, macrochainIds, macrochainInfosById, eyeInfosById, isUnscorableFalseEyePoint);

    const scoring = makeArrayFromCallable(ysize, xsize, () => new LocScore());
    markScoring(
        ysize, xsize, stones, markedDead, scoreFalseEyes,
        strictReachesBlack, strictReachesWhite, regionIds, regionInfosById,
        chainIds, chainInfosById, isFalseEyePoint, eyeIds, eyeInfosById,
        isUnscorableFalseEyePoint, scoring
    );
    return scoring;
}

/**
 * @param {color[][]} stones - BLACK or WHITE or EMPTY indicating the stones on the board.
 * @param {bool[][]} markedDead - true if the location has a stone marked as dead, and false otherwise.
 * @return {LocScore[][]}
 */
function areaScoring(
    stones,
    markedDead,
) {
    const ysize = stones.length;
    const xsize = stones[0].length;

    stones.forEach(row => {
        if(row.length !== xsize)
            throw new Error(`Not all rows in stones are the same length ${xsize}`);
        row.forEach(value => {
            if(value !== EMPTY && value !== BLACK && value !== WHITE)
                throw new Error("Unexpected value in stones " + value);
        });
    });

    if(markedDead.length !== ysize)
        throw new Error(`markedDead is not the same length as stones ${ysize}`);

    markedDead.forEach(row => {
        if(row.length !== xsize)
            throw new Error(`Not all rows in markedDead are the same length as stones ${xsize}`);
    });

    const strictReachesBlack = makeArray(ysize, xsize, false);
    const strictReachesWhite = makeArray(ysize, xsize, false);
    markReachability(ysize, xsize, stones, markedDead, null, strictReachesBlack, strictReachesWhite);

    const scoring = makeArray(ysize, xsize, EMPTY);

    for(let y = 0; y < ysize; y++) {
        for(let x = 0; x < xsize; x++) {
            if(strictReachesWhite[y][x] && !strictReachesBlack[y][x])
                scoring[y][x] = WHITE;
            if(strictReachesBlack[y][x] && !strictReachesWhite[y][x])
                scoring[y][x] = BLACK;
        }
    }
    return scoring;
}


function getOpp(pla) {
    return 3 - pla;
}

function makeArray(ysize, xsize, initialValue) {
    return Array.from({length: ysize}, () =>
                      Array.from({length: xsize}, () => initialValue));
}

function makeArrayFromCallable(ysize, xsize, f) {
    return Array.from({length: ysize}, () =>
                      Array.from({length: xsize}, () => f()));
}

function isOnBoard(y, x, ysize, xsize) {
    return y >= 0 && x >= 0 && y < ysize && x < xsize;
}

function isOnBorder(y, x, ysize, xsize) {
    return y === 0 || x === 0 || y === ysize-1 || x === xsize-1;
}

function isAdjacent(y1, x1, y2, x2) {
    return (y1 === y2 && (x1 === x2 + 1 || x1 === x2 - 1))
        || (x1 === x2 && (y1 === y2 + 1 || y1 === y2 - 1));
}

function print2d(board, f) {
    console.log(string2d(board, f));
}

function string2d(board, f) {
    const ysize = board.length;
    const lines = [];

    for(let y = 0; y < ysize; y++) {
        const pieces = [];
        for(let item of board[y])
            pieces.push(f(item));
        lines.push(pieces.join(''));
    }
    return lines.join('\n');
}

function string2d2(board1, board2, f) {
    const ysize = board1.length;
    const lines = [];

    for(let y = 0; y < ysize; y++) {
        const pieces = [];
        for(let x = 0; x < board1[y].length; x++) {
            const item1 = board1[y][x];
            const item2 = board2[y][x];
            pieces.push(f(item1, item2));
        }
        lines.push(pieces.join(''));
    }
    return lines.join('\n');
}

function colorToStr(color) {
    if(color === EMPTY)
        return '.';
    if(color === BLACK)
        return 'x';
    if(color === WHITE)
        return 'o';
    throw new Error("Invalid color: " + color);
}

function markConnectionBlocks(
    ysize,
    xsize,
    stones,
    markedDead,
    connectionBlocks // mutated by this function
) {
    const patterns = [
        [
            "pp",
            "@e",
            "pe",
        ],
        [
            "ep?",
            "e@e",
            "ep?",
        ],
        [
            "pee",
            "e@p",
            "pee",
        ],
        [
            "?e?",
            "p@p",
            "xxx",
        ],
        [
            "pp",
            "@e",
            "xx",
        ],
        [
            "ep?",
            "e@e",
            "xxx",
        ],
    ];

    for(const pla of [BLACK, WHITE]) {
        const opp = getOpp(pla);

        for(const [pdydy, pdydx, pdxdy, pdxdx] of [
            [1,0,0,1],
            [-1,0,0,1],
            [1,0,0,-1],
            [-1,0,0,-1],
            [0,1,1,0],
            [0,-1,1,0],
            [0,1,-1,0],
            [0,-1,-1,0],
        ]) {
            for(const pattern of patterns) {
                let pylen = pattern.length;
                const pxlen = pattern[0].length;
                const isEdgePattern = pattern[pylen-1].includes('x');

                if(isEdgePattern)
                    pylen--;

                let yRange = Array.from({length: ysize}, (_, i) => i);
                let xRange = Array.from({length: xsize}, (_, i) => i);

                if(isEdgePattern) {
                    if(pdydy === -1)
                        yRange = [pattern.length-2];
                    else if(pdydy === 1)
                        yRange = [ysize - (pattern.length-1)];
                    else if(pdxdy === -1)
                        xRange = [pattern.length-2];
                    else if(pdxdy === 1)
                        xRange = [xsize - (pattern.length-1)];
                }

                for(let y of yRange) {
                    for(let x of xRange) {
                        function getTargetYX(pdy, pdx) {
                            return [
                                y + pdydy*pdy + pdxdy*pdx,
                                x + pdydx*pdy + pdxdx*pdx
                            ];
                        }

                        let [ty, tx] = getTargetYX(pylen-1, pxlen-1);
                        if(!isOnBoard(ty, tx, ysize, xsize))
                            continue;

                        let atLoc;
                        let mismatch = false;
                        for(let pdy = 0; pdy < pylen; pdy++) {
                            for(let pdx = 0; pdx < pxlen; pdx++) {
                                const c = pattern[pdy][pdx];
                                if(c === "?")
                                    continue;

                                [ty, tx] = getTargetYX(pdy, pdx);
                                if(!isOnBoard(ty, tx, ysize, xsize))
                                    continue;

                                if(c === 'p') {
                                    if(!(stones[ty][tx] === pla && !markedDead[ty][tx])) {
                                        mismatch = true;
                                        break;
                                    }
                                }
                                else if(c === 'e') {
                                    if(!(
                                        stones[ty][tx] === EMPTY ||
                                            stones[ty][tx] === pla && !markedDead[ty][tx] ||
                                            stones[ty][tx] === opp && markedDead[ty][tx]
                                    )) {
                                        mismatch = true;
                                        break;
                                    }
                                }
                                else if(c === '@') {
                                    if(stones[ty][tx] !== EMPTY) {
                                        mismatch = true;
                                        break;
                                    }
                                    atLoc = [ty, tx];
                                }
                                else {
                                    throw new Error("Invalid char: " + c);
                                }
                            }
                            if(mismatch)
                                break;
                        }

                        if(!mismatch) {
                            [ty, tx] = atLoc;
                            connectionBlocks[ty][tx] = pla;
                        }
                    }
                }
            }
        }
    }
}


function markReachability(
    ysize,
    xsize,
    stones,
    markedDead,
    connectionBlocks,
    reachesBlack, // mutated by this function
    reachesWhite // mutated by this function
) {
    function fillReach(y, x, reachesPla, pla) {
        if(!isOnBoard(y,x,ysize,xsize))
            return;
        if(reachesPla[y][x])
            return;
        if(stones[y][x] === getOpp(pla) && !markedDead[y][x])
            return;

        reachesPla[y][x] = true;

        if(connectionBlocks && connectionBlocks[y][x] === getOpp(pla))
            return;

        fillReach(y-1, x, reachesPla, pla);
        fillReach(y+1, x, reachesPla, pla);
        fillReach(y, x-1, reachesPla, pla);
        fillReach(y, x+1, reachesPla, pla);
    }

    for(let y = 0; y < ysize; y++) {
        for(let x = 0; x < xsize; x++) {
            if(stones[y][x] === BLACK && !markedDead[y][x])
                fillReach(y, x, reachesBlack, BLACK);
            if(stones[y][x] === WHITE && !markedDead[y][x])
                fillReach(y, x, reachesWhite, WHITE);
        }
    }
}

class RegionInfo {
    constructor(regionId, color, regionAndDame, eyes) {
        this.regionId = regionId;
        this.color = color;
        this.regionAndDame = regionAndDame;
        this.eyes = eyes;
    }
}

function markRegions(
    ysize,
    xsize,
    stones,
    markedDead,
    connectionBlocks,
    reachesBlack,
    reachesWhite,
    regionIds, // mutated by this function
    regionInfosById // mutated by this function
) {
    function fillRegion(y, x, withId, opp, reachesPla, reachesOpp, visited) {
        if(!isOnBoard(y,x,ysize,xsize))
            return;
        if(visited[y][x])
            return;
        if(regionIds[y][x] !== -1)
            return;
        if(stones[y][x] === opp && !markedDead[y][x])
            return;

        visited[y][x] = true;
        regionInfosById[withId].regionAndDame.add([y, x]);

        if(reachesPla[y][x] && !reachesOpp[y][x])
            regionIds[y][x] = withId;

        if(connectionBlocks[y][x] === opp)
            return;

        fillRegion(y-1, x, withId, opp, reachesPla, reachesOpp, visited);
        fillRegion(y+1, x, withId, opp, reachesPla, reachesOpp, visited);
        fillRegion(y, x-1, withId, opp, reachesPla, reachesOpp, visited);
        fillRegion(y, x+1, withId, opp, reachesPla, reachesOpp, visited);
    }

    let nextRegionId = 0;

    for(let y = 0; y < ysize; y++) {
        for(let x = 0; x < xsize; x++) {
            if(reachesBlack[y][x] && !reachesWhite[y][x] && regionIds[y][x] === -1) {
                const regionId = nextRegionId++;
                regionInfosById[regionId] = new RegionInfo(
                    regionId, BLACK, new CoordinateSet(), new Set()
                );

                const visited = makeArray(ysize, xsize, false);
                fillRegion(y, x, regionId, WHITE, reachesBlack, reachesWhite, visited);
            }
            if(reachesWhite[y][x] && !reachesBlack[y][x] && regionIds[y][x] === -1) {
                const regionId = nextRegionId++;
                regionInfosById[regionId] = new RegionInfo(
                    regionId, WHITE, new CoordinateSet(), new Set()
                );

                const visited = makeArray(ysize, xsize, false);
                fillRegion(y, x, regionId, BLACK, reachesWhite, reachesBlack, visited);
            }
        }
    }
}


class ChainInfo {
    constructor(chainId, regionId, color, points, neighbors, adjacents, liberties, isMarkedDead) {
        this.chainId = chainId;
        this.regionId = regionId;
        this.color = color;
        this.points = points;
        this.neighbors = neighbors;
        this.adjacents = adjacents;
        this.liberties = liberties;
        this.isMarkedDead = isMarkedDead;
    }
}

function markChains(
    ysize,
    xsize,
    stones,
    markedDead,
    regionIds,
    chainIds, // mutated by this function
    chainInfosById // mutated by this function
) {
    function fillChain(y, x, withId, color, isMarkedDead) {

        if(!isOnBoard(y,x,ysize,xsize))
            return;
        if(chainIds[y][x] === withId)
            return;

        if(chainIds[y][x] !== -1) {
            const otherId = chainIds[y][x];
            chainInfosById[otherId].neighbors.add(withId);
            chainInfosById[withId].neighbors.add(otherId);
            chainInfosById[withId].adjacents.add([y, x]);
            if(stones[y][x] == EMPTY)
                chainInfosById[withId].liberties.add([y, x]);
            return;
        }
        if(stones[y][x] !== color || markedDead[y][x] !== isMarkedDead) {
            chainInfosById[withId].adjacents.add([y, x]);
            if(stones[y][x] == EMPTY)
                chainInfosById[withId].liberties.add([y, x]);
            return;
        }

        chainIds[y][x] = withId;
        chainInfosById[withId].points.push([y, x]);
        if(chainInfosById[withId].regionId !== regionIds[y][x])
            chainInfosById[withId].regionId = -1;

        assert(color === EMPTY || regionIds[y][x] === chainInfosById[withId].regionId);

        fillChain(y-1, x, withId, color, isMarkedDead);
        fillChain(y+1, x, withId, color, isMarkedDead);
        fillChain(y, x-1, withId, color, isMarkedDead);
        fillChain(y, x+1, withId, color, isMarkedDead);
    }

    let nextChainId = 0;

    for(let y = 0; y < ysize; y++) {
        for(let x = 0; x < xsize; x++) {
            if(chainIds[y][x] === -1) {
                const chainId = nextChainId++;
                const color = stones[y][x];
                const isMarkedDead = markedDead[y][x];

                chainInfosById[chainId] = new ChainInfo(
                    chainId,
                    regionIds[y][x],
                    color,
                    [],
                    new Set(),
                    new CoordinateSet(),
                    new CoordinateSet(),
                    isMarkedDead
                );

                assert(isMarkedDead || color === EMPTY || regionIds[y][x] !== -1);
                fillChain(y, x, chainId, color, isMarkedDead);
            }
        }
    }
}


class MacroChainInfo {
    constructor(macrochainId, regionId, color, points, chains, eyeNeighborsFrom) {
        this.macrochainId = macrochainId;
        this.regionId = regionId;
        this.color = color;
        this.points = points;
        this.chains = chains;
        this.eyeNeighborsFrom = eyeNeighborsFrom;
    }
}

function markMacrochains(
    ysize,
    xsize,
    stones,
    markedDead,
    connectionBlocks,
    regionIds,
    regionInfosById,
    chainIds,
    chainInfosById,
    macrochainIds, // mutated by this function
    macrochainInfosById // mutated by this function
) {
    let nextMacrochainId = 0;

    for(const pla of [BLACK, WHITE]) {
        const opp = getOpp(pla);
        const chainsHandled = new Set();
        const visited = makeArray(ysize, xsize, false);

        for(let chainId in chainInfosById) {
            chainId = Number(chainId);
            if(chainsHandled.has(chainId))
                continue;

            const chainInfo = chainInfosById[chainId];
            if(!(chainInfo.color === pla && !chainInfo.isMarkedDead))
                continue;

            const regionId = chainInfo.regionId;
            assert(regionId !== -1);

            const macrochainId = nextMacrochainId++;
            const points = [];
            const chains = new Set();

            function walkAndAccumulate(y, x) {
                if(!isOnBoard(y,x,ysize,xsize))
                    return;
                if(visited[y][x])
                    return;

                visited[y][x] = true;

                const chainId2 = chainIds[y][x];
                const chainInfo2 = chainInfosById[chainId2];

                let shouldRecurse = false;
                if(stones[y][x] === pla && !markedDead[y][x]) {
                    macrochainIds[y][x] = macrochainId;
                    points.push([y,x]);
                    if(!chains.has(chainId2)) {
                        chains.add(chainId2);
                        chainsHandled.add(chainId2);
                    }
                    shouldRecurse = true;
                }
                else if(regionIds[y][x] === -1 && connectionBlocks[y][x] !== opp) {
                    shouldRecurse = true;
                }

                if(shouldRecurse) {
                    walkAndAccumulate(y-1, x);
                    walkAndAccumulate(y+1, x);
                    walkAndAccumulate(y, x-1);
                    walkAndAccumulate(y, x+1);
                }
            }

            const [y, x] = chainInfo.points[0];
            walkAndAccumulate(y, x);

            macrochainInfosById[macrochainId] = new MacroChainInfo(
                macrochainId,
                regionId,
                pla,
                points,
                chains,
                {} // filled in later
            );

        }

    }

}


class EyeInfo {
    constructor(pla, regionId, eyeId, potentialPoints, realPoints, macrochainNeighborsFrom, isLoose, eyeValue) {
        this.pla = pla;
        this.regionId = regionId;
        this.eyeId = eyeId;
        this.potentialPoints = potentialPoints;
        this.realPoints = realPoints;
        this.macrochainNeighborsFrom = macrochainNeighborsFrom;
        this.isLoose = isLoose;
        this.eyeValue = eyeValue;
    }
}

function markPotentialEyes(
    ysize,
    xsize,
    stones,
    markedDead,
    strictReachesBlack,
    strictReachesWhite,
    regionIds,
    regionInfosById, // mutated by this function
    macrochainIds,
    macrochainInfosById, // mutated by this function
    eyeIds, // mutated by this function
    eyeInfosById // mutated by this function
) {
    let nextEyeId = 0;
    const visited = makeArray(ysize, xsize, false);
    for(let y = 0; y < ysize; y++) {
        for(let x = 0; x < xsize; x++) {
            if(visited[y][x])
                continue;
            if(eyeIds[y][x] !== -1)
                continue;
            if(stones[y][x] !== EMPTY && !markedDead[y][x])
                continue;

            const regionId = regionIds[y][x];
            if(regionId === -1)
                continue;

            const regionInfo = regionInfosById[regionId];
            const pla = regionInfo.color;
            const isLoose = strictReachesWhite[y][x] && strictReachesBlack[y][x];
            const eyeId = nextEyeId++;
            const potentialPoints = new CoordinateSet();
            const macrochainNeighborsFrom = {};

            function accRegion(y, x, prevY, prevX) {
                if(!isOnBoard(y,x,ysize,xsize))
                    return;
                if(visited[y][x])
                    return;
                if(regionIds[y][x] !== regionId)
                    return;

                if(macrochainIds[y][x] !== -1) {
                    const macrochainId = macrochainIds[y][x];

                    if(!macrochainNeighborsFrom[macrochainId])
                        macrochainNeighborsFrom[macrochainId] = new CoordinateSet();
                    macrochainNeighborsFrom[macrochainId].add([prevY, prevX]);
                    if(!macrochainInfosById[macrochainId].eyeNeighborsFrom[eyeId])
                        macrochainInfosById[macrochainId].eyeNeighborsFrom[eyeId] = new CoordinateSet();

                    macrochainInfosById[macrochainId].eyeNeighborsFrom[eyeId].add([y, x]);
                }

                if(stones[y][x] !== EMPTY && !markedDead[y][x])
                    return;

                visited[y][x] = true;
                eyeIds[y][x] = eyeId;
                potentialPoints.add([y,x]);

                accRegion(y-1, x, y, x);
                accRegion(y+1, x, y, x);
                accRegion(y, x-1, y, x);
                accRegion(y, x+1, y, x);
            }

            assert(macrochainIds[y][x] === -1);
            accRegion(y, x, 10000, 10000);

            eyeInfosById[eyeId] = new EyeInfo(
                pla,
                regionId,
                eyeId,
                potentialPoints,
                new CoordinateSet(), // filled in later
                macrochainNeighborsFrom,
                isLoose,
                0 // filled in later
            );

            regionInfosById[regionId].eyes.add(eyeId);

        }
    }

}


function markFalseEyePoints(
    ysize,
    xsize,
    regionIds,
    macrochainIds,
    macrochainInfosById,
    eyeInfosById,
    isFalseEyePoint // mutated by this function
) {
    for(let origEyeId in eyeInfosById) {
        origEyeId = Number(origEyeId);
        const origEyeInfo = eyeInfosById[origEyeId];

        for(let origMacrochainId in origEyeInfo.macrochainNeighborsFrom) {
            origMacrochainId = Number(origMacrochainId);
            const neighborsFromEyePoints = origEyeInfo.macrochainNeighborsFrom[origMacrochainId];

            for(let [ey, ex] of neighborsFromEyePoints) {
                let sameEyeAdjCount = 0;
                for(let [y, x] of [[ey-1,ex], [ey+1,ex], [ey,ex-1], [ey,ex+1]]) {
                    if(origEyeInfo.potentialPoints.has([y, x]))
                        sameEyeAdjCount += 1;
                }
                if(sameEyeAdjCount > 1)
                    continue;

                const reachingSides = new CoordinateSet();
                const visitedMacro = new Set();
                const visitedOtherEyes = new Set();
                const visitedOrigEyePoints = new CoordinateSet();
                visitedOrigEyePoints.add([ey,ex]);

                let targetSideCount = 0;
                for(let [y, x] of [[ey-1,ex], [ey+1,ex], [ey,ex-1], [ey, ex+1]]) {
                    if(isOnBoard(y, x, ysize, xsize) && regionIds[y][x] === origEyeInfo.regionId)
                        targetSideCount += 1;
                }
                // console.log("CHECKING EYE " + origEyeId + " " + [ey,ex]);
                function search(macrochainId) {
                    if(visitedMacro.has(macrochainId))
                        return false;
                    visitedMacro.add(macrochainId);
                    // console.log("Searching macrochain " + macrochainId + "");

                    const macrochainInfo = macrochainInfosById[macrochainId];
                    for(let eyeId in macrochainInfo.eyeNeighborsFrom) {
                        eyeId = Number(eyeId);
                        if(visitedOtherEyes.has(eyeId))
                            continue;
                        // console.log("Searching macrochain " + macrochainId + " iterating eyeId " + eyeId + "");

                        if(eyeId === origEyeId) {
                            // console.log("Orig!");
                            const eyeInfo = eyeInfosById[eyeId];
                            for(let [y, x] of macrochainInfo.eyeNeighborsFrom[eyeId]) {
                                if(isAdjacent(y, x, ey, ex)) {
                                    reachingSides.add([y, x]);
                                    if(reachingSides.size >= targetSideCount)
                                        return true;
                                }
                            }

                            const pointsReached = findRecursivelyAdjacentPoints(
                                eyeInfo.potentialPoints,
                                eyeInfo.macrochainNeighborsFrom[macrochainId],
                                visitedOrigEyePoints
                            );
                            if(pointsReached.size === 0)
                                continue;

                            pointsReached.forEach(item => visitedOrigEyePoints.add(item));

                            if(eyeInfo.eyeValue > 0) {
                                for(let point of pointsReached) {
                                    if(eyeInfo.realPoints.has(point))
                                        return true;
                                }
                            }

                            for(let [y, x] of pointsReached) {
                                if(isAdjacent(y, x, ey, ex)) {
                                    reachingSides.add([y,x]);
                                    if(reachingSides.size >= targetSideCount)
                                        return true;
                                }
                            }

                            for(let nextMacrochainId in eyeInfo.macrochainNeighborsFrom) {
                                if([...eyeInfo.macrochainNeighborsFrom[nextMacrochainId]].some(point => pointsReached.has(point))) {
                                    if(search(Number(nextMacrochainId)))
                                        return true;
                                }
                            }

                        }
                        else {
                            visitedOtherEyes.add(eyeId);
                            const eyeInfo = eyeInfosById[eyeId];
                            if(eyeInfo.eyeValue > 0)
                                return true;

                            for(let nextMacrochainId of Object.keys(eyeInfo.macrochainNeighborsFrom)) {
                                if(search(Number(nextMacrochainId)))
                                    return true;
                            }
                        }
                    }
                    return false;
                };

                if(search(origMacrochainId)) {
                    // pass
                }
                else {
                    isFalseEyePoint[ey][ex] = true;
                }
            }
        }
    }
}



function findRecursivelyAdjacentPoints(
    withinSet,
    fromPoints,
    excludingPoints
) {
    const expanded = new CoordinateSet();
    fromPoints = [...fromPoints];

    for(let i = 0; i < fromPoints.length; i++) {
        const point = fromPoints[i];
        if(excludingPoints.has(point) || expanded.has(point) || !withinSet.has(point))
            continue;
        expanded.add(point);
        const [y, x] = point;
        fromPoints.push([y-1, x]);
        fromPoints.push([y+1, x]);
        fromPoints.push([y, x-1]);
        fromPoints.push([y, x+1]);
    }

    return expanded;
}


function getPieces(ysize, xsize, points, pointsToDelete) {
    const usedPoints = new CoordinateSet();
    function floodfill(point, piece) {
        if(usedPoints.has(point) || pointsToDelete.has(point))
            return;
        usedPoints.add(point);
        piece.add(point);
        const [y, x] = point;
        const adjacents = [[y-1, x], [y+1, x], [y, x-1], [y, x+1]];
        for(let adjacent of adjacents) {
            if(points.has(adjacent))
                floodfill(adjacent, piece);
        }
    }

    const pieces = [];
    for(let point of points) {
        if(!usedPoints.has(point)) {
            const piece = new CoordinateSet();
            floodfill(point, piece);
            if(piece.size > 0)
                pieces.push(piece);
        }
    }
    return pieces;
}

function isPseudoLegal(ysize, xsize, stones, chainIds, chainInfosById, y, x, pla) {
    if(stones[y][x] !== EMPTY)
        return false;
    const adjacents = [[y-1, x], [y+1, x], [y, x-1], [y, x+1]];
    const opp = getOpp(pla);
    for(let [ay, ax] of adjacents) {
        if(isOnBoard(ay, ax, ysize, xsize)) {
            if(stones[ay][ax] !== opp)
                return true;
            if(chainInfosById[chainIds[ay][ax]].liberties.size <= 1)
                return true;
        }
    }
    return false;
}

function countAdjacentsIn(y, x, points) {
    let count = 0;
    const adjacents = [[y-1, x], [y+1, x], [y, x-1], [y, x+1]];
    for(let a of adjacents) {
        if(points.has(a))
            count += 1;
    }
    return count;
}

class EyePointInfo {
    constructor(
        adjPoints,
        adjEyePoints,
        numEmptyAdjPoints=0,
        numEmptyAdjFalsePoints=0,
        numEmptyAdjEyePoints=0,
        numOppAdjFalsePoints=0,
        isFalseEyePoke=false,
        numMovesToBlock=0,
        numBlockablesDependingOnThisSpot=0
    ) {
        this.adjPoints = adjPoints;
        this.adjEyePoints = adjEyePoints;
        this.numEmptyAdjPoints = numEmptyAdjPoints;
        this.numEmptyAdjFalsePoints = numEmptyAdjFalsePoints;
        this.numEmptyAdjEyePoints = numEmptyAdjEyePoints;
        this.numOppAdjFalsePoints = numOppAdjFalsePoints;
        this.isFalseEyePoke = isFalseEyePoke;
        this.numMovesToBlock = numMovesToBlock;
        this.numBlockablesDependingOnThisSpot = numBlockablesDependingOnThisSpot;
    }
}


function count(points, predicate) {
    let c = 0;
    for(let p of points)
        if(predicate(p)) {
            c++;
    }
    return c;
}

function markEyeValues(
    ysize,
    xsize,
    stones,
    markedDead,
    regionIds,
    regionInfosById,
    chainIds,
    chainInfosById,
    isFalseEyePoint,
    eyeIds,
    eyeInfosById // mutated by this function
) {
    for(let eyeId in eyeInfosById) {
        eyeId = Number(eyeId);

        const eyeInfo = eyeInfosById[eyeId];
        const pla = eyeInfo.pla;
        const opp = getOpp(pla);

        const infoByPoint = {};
        eyeInfo.realPoints = new CoordinateSet();
        for(let [y, x] of eyeInfo.potentialPoints) {
            if(!isFalseEyePoint[y][x]) {
                eyeInfo.realPoints.add([y, x]);

                const info = new EyePointInfo([], []);
                infoByPoint[[y, x]] = info;
            }
        }

        for(let [y, x] of eyeInfo.realPoints) {
            const info = infoByPoint[[y, x]];
            const adjacents = [[y-1, x], [y+1, x], [y, x-1], [y, x+1]];
            for(let [ay, ax] of adjacents) {
                if(!isOnBoard(ay, ax, ysize, xsize))
                    continue;

                info.adjPoints.push([ay, ax]);
                if(eyeInfo.realPoints.has([ay, ax]))
                    info.adjEyePoints.push([ay, ax]);
            }
        }

        for(let [y, x] of eyeInfo.realPoints) {
            const info = infoByPoint[[y, x]];
            for(let [ay, ax] of info.adjPoints) {
                if(stones[ay][ax] === EMPTY)
                    info.numEmptyAdjPoints += 1;
                if(stones[ay][ax] === EMPTY && eyeInfo.realPoints.has([ay, ax]))
                    info.numEmptyAdjEyePoints += 1;
                if(stones[ay][ax] === EMPTY && isFalseEyePoint[ay][ax])
                    info.numEmptyAdjFalsePoints += 1;
                if(stones[ay][ax] === opp && isFalseEyePoint[ay][ax])
                    info.numOppAdjFalsePoints += 1;
            }

            if(info.numOppAdjFalsePoints > 0 && stones[y][x] === opp)
                info.isFalseEyePoke = true;
            if(info.numEmptyAdjFalsePoints >= 2 && stones[y][x] === opp)
                info.isFalseEyePoke = true;
        }

        for(let [y, x] of eyeInfo.realPoints) {
            const info = infoByPoint[[y, x]];
            info.numMovesToBlock = 0;
            info.numMovesToBlockNoOpps = 0;

            for(let [ay, ax] of info.adjPoints) {
                let block = 0;
                if(stones[ay][ax] === EMPTY && !eyeInfo.realPoints.has([ay, ax]))
                    block = 1;
                if(stones[ay][ax] === EMPTY && [ay, ax] in infoByPoint && infoByPoint[[ay, ax]].numOppAdjFalsePoints >= 1)
                    block = 1;
                if(stones[ay][ax] === opp && [ay, ax] in infoByPoint && infoByPoint[[ay, ax]].numEmptyAdjFalsePoints >= 1)
                    block = 1;
                if(stones[ay][ax] === opp && isFalseEyePoint[ay][ax])
                    block = 1000;
                if(stones[ay][ax] === opp && [ay, ax] in infoByPoint && infoByPoint[[ay, ax]].isFalseEyePoke)
                    block = 1000;

                info.numMovesToBlock += block;
            }
        }

        let eyeValue = 0;
        if(count(eyeInfo.realPoints, ([y, x]) => infoByPoint[[y, x]].numMovesToBlock <= 1) >= 1)
            eyeValue = 1;

        for(let [dy, dx] of eyeInfo.realPoints) {

            if(!isPseudoLegal(ysize, xsize, stones, chainIds, chainInfosById, dy, dx, pla))
                continue;

            const pieces = getPieces(ysize, xsize, eyeInfo.realPoints, new CoordinateSet([[dy, dx]]));
            if(pieces.length < 2)
                continue;

            let shouldBonus = infoByPoint[[dy, dx]].numOppAdjFalsePoints === 1;
            let numDefiniteEyePieces = 0;
            for(let piece of pieces) {
                let zeroMovesToBlock = false;
                for(let point of piece) {
                    if(infoByPoint[point].numMovesToBlock <= 0) {
                        zeroMovesToBlock = true;
                        break;
                    }
                    if(shouldBonus && infoByPoint[point].numMovesToBlock <= 1) {
                        zeroMovesToBlock = true;
                        break;
                    }
                }

                if(zeroMovesToBlock)
                    numDefiniteEyePieces++;
            }
            eyeValue = Math.max(eyeValue, numDefiniteEyePieces);
        }

        let markedDeadCount = count(eyeInfo.realPoints, ([y,x]) => stones[y][x] === opp && markedDead[y][x]);
        if(markedDeadCount >= 5)
            eyeValue = Math.max(eyeValue, 1);
        if(markedDeadCount >= 8)
            eyeValue = Math.max(eyeValue, 2);

        if(eyeValue < 2 && (
            eyeInfo.realPoints.size
                - count(eyeInfo.realPoints, ([y,x]) => infoByPoint[[y,x]].numMovesToBlock >= 1)
                - count(eyeInfo.realPoints, ([y,x]) => infoByPoint[[y,x]].numMovesToBlock >= 2)
                - count(eyeInfo.realPoints, ([y,x]) => stones[y][x] === opp && infoByPoint[[y,x]].adjEyePoints.length >= 2)
                >= 6
        )) {
            eyeValue = Math.max(eyeValue, 2);
        }

        if(eyeValue < 2 && (
            count(eyeInfo.realPoints, ([y,x]) => stones[y][x] === EMPTY && infoByPoint[[y,x]].adjEyePoints.length >= 4) +
                count(eyeInfo.realPoints, ([y,x]) => stones[y][x] === EMPTY && infoByPoint[[y,x]].adjEyePoints.length >= 3)
                >= 6
        )) {
            eyeValue = Math.max(eyeValue, 2);
        }

        if(eyeValue < 2) {
            for(let [dy, dx] of eyeInfo.realPoints) {
                if(stones[dy][dx] !== EMPTY)
                    continue;
                if(isOnBorder(dy, dx, ysize, xsize))
                    continue;
                if(!isPseudoLegal(ysize, xsize, stones, chainIds, chainInfosById, dy, dx, pla))
                    continue;

                const info1 = infoByPoint[[dy, dx]];
                if(info1.numMovesToBlock > 1 || info1.adjEyePoints.length < 3)
                    continue;

                for(let adjacent of info1.adjEyePoints) {
                    const info2 = infoByPoint[adjacent];
                    if(info2.adjEyePoints.length < 3)
                        continue;
                    if(info2.numMovesToBlock > 1)
                        continue;

                    const [dy2, dx2] = adjacent;
                    if(stones[dy2][dx2] !== EMPTY && info2.numEmptyAdjEyePoints <= 1)
                        continue;

                    const pieces = getPieces(ysize, xsize, eyeInfo.realPoints, new CoordinateSet([[dy, dx], adjacent]));
                    if(pieces.length < 2)
                        continue;

                    let numDefiniteEyePieces = 0;
                    let numDoubleDefiniteEyePieces = 0;

                    for(let piece of pieces) {
                        let numZeroMovesToBlock = 0;
                        for(let point of piece) {
                            if(infoByPoint[point].numMovesToBlock <= 0) {
                                numZeroMovesToBlock += 1;
                                if(numZeroMovesToBlock >= 2)
                                    break;
                            }
                        }
                        if(numZeroMovesToBlock >= 1)
                            numDefiniteEyePieces += 1;
                        if(numZeroMovesToBlock >= 2)
                            numDoubleDefiniteEyePieces += 1;
                    }

                    if(numDefiniteEyePieces >= 2 &&
                       numDoubleDefiniteEyePieces >= 1 &&
                       (stones[dy2][dx2] === EMPTY || numDoubleDefiniteEyePieces >= 2)
                      ) {
                        eyeValue = Math.max(eyeValue, 2);
                        break;
                    }

                }

                if(eyeValue >= 2)
                    break;
            }
        }

        if(eyeValue < 2) {
            const deadOppsInEye = new CoordinateSet();
            const unplayableInEye = [];
            for(let point of eyeInfo.realPoints) {
                const [dy, dx] = point;
                if(stones[dy][dx] === opp && markedDead[dy][dx])
                    deadOppsInEye.add(point);
                else if(!isPseudoLegal(ysize, xsize, stones, chainIds, chainInfosById, dy, dx, pla))
                    unplayableInEye.push(point);
            }

            if(deadOppsInEye.size > 0) {
                let numThrowins = 0;
                for(let [y,x] of eyeInfo.potentialPoints) {
                    if(stones[y][x] === opp && isFalseEyePoint[y][x])
                        numThrowins += 1;
                }

                const possibleOmissions = [...unplayableInEye];
                possibleOmissions.push(null);
                let allGoodForDefender = true;
                for(let omitted of possibleOmissions) {
                    const remainingShape = deadOppsInEye.copy();
                    for(let point of unplayableInEye) {
                        if(point !== omitted)
                            remainingShape.add(point);
                    }

                    const initialPieceCount = getPieces(ysize, xsize, remainingShape, new CoordinateSet()).length;
                    let numBottlenecks = 0;
                    let numNonBottlenecksHighDegree = 0;
                    for(let pointToDelete of remainingShape) {
                        const [dy,dx] = pointToDelete;
                        if(getPieces(ysize, xsize, remainingShape, new CoordinateSet([pointToDelete])).length > initialPieceCount)
                            numBottlenecks += 1;
                        else if(countAdjacentsIn(dy,dx,remainingShape) >= 3)
                            numNonBottlenecksHighDegree += 1;
                    }

                    let bonus = 0;
                    if(remainingShape.size >= 7)
                        bonus += 1;

                    if(initialPieceCount - numThrowins + Math.floor((numBottlenecks + numNonBottlenecksHighDegree + bonus) / 2) < 2) {
                        allGoodForDefender = false;
                        break;
                    }
                }
                if(allGoodForDefender)
                    eyeValue = 2;
            }
        }

        eyeValue = Math.min(eyeValue, 2);
        eyeInfo.eyeValue = eyeValue;
    }
}

function markScoring(
    ysize,
    xsize,
    stones,
    markedDead,
    scoreFalseEyes,
    strictReachesBlack,
    strictReachesWhite,
    regionIds,
    regionInfosById,
    chainIds,
    chainInfosById,
    isFalseEyePoint,
    eyeIds,
    eyeInfosById,
    isUnscorableFalseEyePoint,
    scoring // mutated by this function
) {
    const extraBlackUnscoreablePoints = new CoordinateSet();
    const extraWhiteUnscoreablePoints = new CoordinateSet();
    for(let y = 0; y < ysize; y++) {
        for(let x = 0; x < xsize; x++) {
            if(isUnscorableFalseEyePoint[y][x] && stones[y][x] != EMPTY && markedDead[y][x]) {
                const adjacents = [[y-1, x], [y+1, x], [y, x-1], [y, x+1]];
                if(stones[y][x] == WHITE) {
                    for(const point of adjacents)
                        extraBlackUnscoreablePoints.add(point);
                }
                else {
                    for(const point of adjacents)
                        extraWhiteUnscoreablePoints.add(point);
                }
            }
        }
    }

    for(let y = 0; y < ysize; y++) {
        for(let x = 0; x < xsize; x++) {
            const s = scoring[y][x];
            const regionId = regionIds[y][x];

            if(regionId === -1) {
                s.isDame = true;
            }
            else {
                const regionInfo = regionInfosById[regionId];
                const color = regionInfo.color;
                const totalEyes = Array.from(regionInfo.eyes)
                      .reduce((acc, eyeId) => acc + eyeInfosById[eyeId].eyeValue, 0);

                if(totalEyes <= 1)
                    s.belongsToSekiGroup = regionInfo.color;
                if(isFalseEyePoint[y][x])
                    s.isFalseEye = true;
                if(isUnscorableFalseEyePoint[y][x])
                    s.isUnscorableFalseEye = true;
                if((stones[y][x] == EMPTY || markedDead[y][x]) && (
                    (color == BLACK && extraBlackUnscoreablePoints.has([y,x])) ||
                        (color == WHITE && extraWhiteUnscoreablePoints.has([y,x]))
                )) {
                    s.isUnscorableFalseEye = true;
                }

                s.eyeValue = eyeIds[y][x] !== -1 ? eyeInfosById[eyeIds[y][x]].eyeValue : 0;

                if((stones[y][x] !== color || markedDead[y][x]) &&
                   s.belongsToSekiGroup === EMPTY &&
                   (scoreFalseEyes || !s.isUnscorableFalseEye) &&
                   chainInfosById[chainIds[y][x]].regionId === regionId &&
                   !(color === WHITE && strictReachesBlack[y][x]) &&
                   !(color === BLACK && strictReachesWhite[y][x])
                  ) {
                    s.isTerritoryFor = color;
                }
            }
        }
    }
}

function assert(condition, message) {
    if(!condition) {
        throw new Error(message || "Assertion failed");
    }
}

class CoordinateSet {
    constructor(initialCoords = []) {
        this.map = new Map();
        this.size = 0;

        if(initialCoords.length > 0) {
            for(let coord of initialCoords) {
                this.add(coord);
            }
        }
    }

    add(coord) {
        const [y, x] = coord;
        if(!this.map.has(y)) {
            this.map.set(y, new Set());
        }
        if(!this.map.get(y).has(x)) {
            this.map.get(y).add(x);
            this.size++;
        }
    }

    has(coord) {
        const [y, x] = coord;
        return this.map.has(y) && this.map.get(y).has(x);
    }

    forEach(callback) {
        for(let [y, xSet] of this.map.entries()) {
            for(let x of xSet) {
                callback([y, x]);
            }
        }
    }

    copy() {
        const ret = new CoordinateSet();
        ret.map = new Map(this.map);
        ret.size = this.size;
        return ret;
    }

    [Symbol.iterator]() {
        const allCoords = [];
        for(let [y, xSet] of this.map.entries()) {
            for(let x of xSet) {
                allCoords.push([y, x]);
            }
        }
        return allCoords[Symbol.iterator]();
    }
}


export {
    EMPTY,
    BLACK,
    WHITE,
    LocScore,
    finalTerritoryScore,
    finalAreaScore,
    territoryScoring,
    areaScoring,

    // Other utils
    getOpp,
    isOnBoard,
    isOnBorder,
    print2d,
    string2d,
    string2d2,
    colorToStr,
};

