/*
 * Copyright (C) Online-Go.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { GobanCore, GobanConfig, GobanHooks, ColoredCircle } from "./GobanCore";
//import { GobanPixi } from './GobanPixi';
import { GobanCanvas, GobanCanvasConfig } from "./GobanCanvas";
import { GobanSVG, GobanSVGConfig } from "./GobanSVG";
import { EventEmitter } from "eventemitter3";
import { MoveTreePenMarks } from "./MoveTree";

let stored_config: GobanConfig = {};
try {
    stored_config = JSON.parse(localStorage.getItem("config") || "{}");
} catch (e) {}

GobanCore.hooks.getSelectedThemes = () => ({
    //white: "Shell",
    //black: "Slate",
    //board: "Kaya",
    white: "Anime",
    black: "Anime",
    board: "Anime",
});

const base_config: GobanConfig = Object.assign(
    {
        interactive: true,
        mode: "puzzle",
        //"player_id": 0,
        //"server_socket": null,
        square_size: 25,
        original_sgf: `
        (;FF[4]
        CA[UTF-8]
        GM[1]
        GN[ai japanese hc 9]
        PC[https://online-go.com/review/290167]
        PB[Black]
        PW[White]
        BR[3p]
        WR[3p]
        TM[0]OT[0 none]
        RE[?]
        SZ[19]
        KM[6.5]
        RU[Japanese]

        ;B[sh]
        ;W[sk]
        ;B[sn]
        ;W[sp]
        )
    `,
        draw_top_labels: true,
        draw_left_labels: true,
        draw_right_labels: true,
        draw_bottom_labels: true,
        bounds: {
            left: 0,
            right: 18,
            top: 0,
            bottom: 18,
        },
    },
    stored_config,
);

const hooks: GobanHooks = {
    //getCoordinateDisplaySystem: () => "1-1",
    getCoordinateDisplaySystem: () => "A1",
    getCDNReleaseBase: () => "",
};
GobanCore.setHooks(hooks);

function save() {
    localStorage.setItem("config", JSON.stringify(base_config));
}

function clear() {
    localStorage.remove("config");
}
(window as any)["clear"] = clear;
/*
            "getPuzzlePlacementSetting": () => {
                return {"mode": "play"};
            },
            */

const fiddler = new EventEmitter();

function Main(): JSX.Element {
    const [_update, _setUpdate] = React.useState(1);
    const [svg_or_canvas, setSVGOrCanvas] = React.useState("svg");
    function forceUpdate() {
        _setUpdate(_update + 1);
    }
    function redraw() {
        save();
        forceUpdate();
        fiddler.emit("redraw");
    }

    return (
        <div>
            <div>
                <div className="inline-block">
                    <div className="setting">
                        {svg_or_canvas} mode:{" "}
                        <button
                            onClick={() => {
                                setSVGOrCanvas(svg_or_canvas === "svg" ? "canvas" : "svg");
                                forceUpdate();
                            }}
                        >{`Switch to ${svg_or_canvas === "svg" ? "Canvas" : "SVG"}`}</button>
                    </div>

                    <div className="setting">
                        <span>Square size:</span>
                        <input
                            type="range"
                            value={base_config.square_size as number}
                            onChange={(ev) => {
                                let ss = Math.max(1, parseInt(ev.target.value));
                                //console.log(ss);
                                if (!ss) {
                                    ss = 1;
                                }
                                base_config.square_size = ss;
                                forceUpdate();
                                fiddler.emit("setSquareSize", ss);
                            }}
                        />
                    </div>

                    <div className="setting">
                        <span>Top labels:</span>
                        <input
                            type="checkbox"
                            checked={base_config.draw_top_labels}
                            onChange={(ev) => {
                                base_config.draw_top_labels = ev.target.checked;
                                redraw();
                            }}
                        />
                    </div>

                    <div className="setting">
                        <span>Left labels:</span>
                        <input
                            type="checkbox"
                            checked={base_config.draw_left_labels}
                            onChange={(ev) => {
                                base_config.draw_left_labels = ev.target.checked;
                                redraw();
                            }}
                        />
                    </div>
                    <div className="setting">
                        <span>Right labels:</span>
                        <input
                            type="checkbox"
                            checked={base_config.draw_right_labels}
                            onChange={(ev) => {
                                base_config.draw_right_labels = ev.target.checked;
                                redraw();
                            }}
                        />
                    </div>
                    <div className="setting">
                        <span>Bottom labels:</span>
                        <input
                            type="checkbox"
                            checked={base_config.draw_bottom_labels}
                            onChange={(ev) => {
                                base_config.draw_bottom_labels = ev.target.checked;
                                redraw();
                            }}
                        />
                    </div>
                </div>
                <div className="inline-block">
                    <div className="setting">
                        <span>Top bounds:</span>
                        <input
                            type="range"
                            min="0"
                            max="18"
                            step="1"
                            value={base_config.bounds?.top}
                            onChange={(ev) => {
                                if (base_config.bounds) {
                                    base_config.bounds.top = parseInt(ev.target.value);
                                }
                                redraw();
                            }}
                        />
                    </div>
                    <div className="setting">
                        <span>Left bounds:</span>
                        <input
                            type="range"
                            min="0"
                            max="18"
                            step="1"
                            value={base_config.bounds?.left}
                            onChange={(ev) => {
                                if (base_config.bounds) {
                                    base_config.bounds.left = parseInt(ev.target.value);
                                }
                                redraw();
                            }}
                        />
                    </div>
                    <div className="setting">
                        <span>Right bounds:</span>
                        <input
                            type="range"
                            min="0"
                            max="18"
                            step="1"
                            value={base_config.bounds?.right}
                            onChange={(ev) => {
                                if (base_config.bounds) {
                                    base_config.bounds.right = parseInt(ev.target.value);
                                }
                                redraw();
                            }}
                        />
                    </div>
                    <div className="setting">
                        <span>Bottom bounds:</span>
                        <input
                            type="range"
                            min="0"
                            max="18"
                            step="1"
                            value={base_config.bounds?.bottom}
                            onChange={(ev) => {
                                if (base_config.bounds) {
                                    base_config.bounds.bottom = parseInt(ev.target.value);
                                }
                                redraw();
                            }}
                        />
                    </div>
                </div>
            </div>

            {/*false && <ReactGobanPixi /> */}
            {Array.from(
                Array(
                    // 20
                    0,
                ),
            ).map((_, idx) =>
                svg_or_canvas === "svg" ? (
                    <ReactGobanSVG key={idx} />
                ) : (
                    <ReactGobanCanvas key={idx} />
                ),
            )}
            {true && (svg_or_canvas === "svg" ? <ReactGobanSVG /> : <ReactGobanCanvas />)}
        </div>
    );
}

interface ReactGobanProps {}

function ReactGoban<GobanClass extends GobanCore>(
    ctor: { new (x: GobanCanvasConfig | GobanSVGConfig): GobanClass },
    props: ReactGobanProps,
): JSX.Element {
    const container = React.useRef(null);
    const move_tree_container = React.useRef(null);
    let goban: GobanCore;

    React.useEffect(() => {
        const config: GobanCanvasConfig | GobanSVGConfig = Object.assign({}, base_config, {
            board_div: container.current || undefined,
            move_tree_container: move_tree_container.current || undefined,
        });

        goban = new ctor(config);

        const heatmap: number[][] = [];
        for (let i = 0; i < 19; i++) {
            heatmap[i] = [];
            for (let j = 0; j < 19; j++) {
                heatmap[i][j] = 0.0;
            }
        }

        fiddler.on("setSquareSize", (ss) => {
            const start = Date.now();
            goban.setSquareSize(ss);
            const end = Date.now();
            console.log("SSS time: ", end - start);
        });

        fiddler.on("redraw", () => {
            const start = Date.now();
            goban.draw_top_labels = !!base_config.draw_top_labels;
            goban.draw_left_labels = !!base_config.draw_left_labels;
            goban.draw_right_labels = !!base_config.draw_right_labels;
            goban.draw_bottom_labels = !!base_config.draw_bottom_labels;
            goban.config.draw_top_labels = !!base_config.draw_top_labels;
            goban.config.draw_left_labels = !!base_config.draw_left_labels;
            goban.config.draw_right_labels = !!base_config.draw_right_labels;
            goban.config.draw_bottom_labels = !!base_config.draw_bottom_labels;
            if (base_config.bounds) {
                goban.setBounds(base_config.bounds);
            }
            goban.redraw(true);
            const end = Date.now();
            console.log("Redraw time: ", end - start);
        });

        let i = 0;
        const start = Date.now();
        const NUM_MOVES = 300;
        //const NUM_MOVES = 20;
        const interval = setInterval(() => {
            i++;
            if (i >= NUM_MOVES) {
                if (i === NUM_MOVES) {
                    const end = Date.now();
                    console.log("Done in ", end - start);

                    // setup iso branch
                    const cur = goban.engine.cur_move;
                    goban.engine.place(18, 16);
                    goban.engine.place(18, 17);
                    goban.engine.place(17, 16);
                    goban.engine.place(17, 17);

                    goban.engine.place(18, 2);
                    goban.engine.place(18, 1);

                    goban.engine.jumpTo(cur);
                    goban.engine.place(17, 16);
                    goban.engine.place(17, 17);
                    goban.engine.place(18, 16);
                    goban.engine.place(18, 17);

                    goban.engine.place(18, 1);
                    goban.engine.place(18, 2);

                    /* test stuff for various features */
                    {
                        heatmap[18][18] = 1.0;
                        heatmap[18][17] = 0.5;
                        heatmap[18][16] = 0.1;
                        goban.setHeatmap(heatmap, true);

                        // blue move
                        const circle: ColoredCircle = {
                            //move: branch.moves[0],
                            move: { x: 16, y: 17 },
                            color: "rgba(0,0,0,0)",
                        };
                        const circle2: ColoredCircle = {
                            //move: branch.moves[0],
                            move: { x: 17, y: 17 },
                            color: "rgba(0,0,0,0)",
                        };

                        goban.setMark(16, 17, "blue_move", true);
                        goban.setMark(17, 17, "blue_move", true);
                        circle.border_width = 0.2;
                        circle.border_color = "rgb(0, 130, 255)";
                        circle.color = "rgba(0, 130, 255, 0.7)";
                        circle2.border_width = 0.2;
                        circle2.border_color = "rgb(0, 130, 255)";
                        circle2.color = "rgba(0, 130, 255, 0.7)";
                        goban.setColoredCircles([circle, circle2], false);
                    }

                    // Shapes & labels
                    goban.setMark(15, 16, "triangle", true);
                    goban.setMark(15, 15, "square", true);
                    goban.setMark(15, 14, "circle", true);
                    goban.setMark(15, 13, "cross", true);
                    goban.setMark(15, 12, "top", true);
                    goban.setSubscriptMark(15, 12, "sub", true);
                    goban.setMark(15, 11, "A", true);

                    // pen marks
                    const marks: MoveTreePenMarks = [];

                    {
                        const points: number[] = [];
                        for (let i = 0; i < 50; ++i) {
                            points.push(4 + i / 10);
                            points.push(9 + Math.sin(i) * 19);
                        }

                        marks.push({
                            color: "#ff8800",
                            points,
                        });
                    }
                    {
                        const points: number[] = [];
                        for (let i = 0; i < 50; ++i) {
                            points.push(9 + i / 10);
                            points.push(20 + Math.sin(i) * 19);
                        }

                        marks.push({
                            color: "#3388ff",
                            points,
                        });
                    }

                    goban.drawPenMarks(marks);
                }
                clearInterval(interval);
                return;
            }
            const x = Math.floor(i / 19);
            const y = Math.floor(i % 19);
            goban.engine.place(x, y);
            if (i === 3) {
                /*
                goban.setMark(x, y, "blue_move", true);

                const circle: ColoredCircle = {
                    //move: branch.moves[0],
                    move: { x, y },
                    color: "rgba(0,0,0,0)",
                };

                // blue move
                goban.setMark(x, y, "blue_move", true);
                circle.border_width = 0.5;
                circle.border_color = "rgb(0, 130, 255)";
                circle.color = "rgba(0, 130, 255, 0.7)";
                goban.setColoredCircles([circle], false);
                */
            }
            //goban.redraw(true);
        }, 1);

        return () => {
            goban.destroy();
        };
    }, [container]);

    return (
        <React.Fragment>
            <div className="Goban">
                <div ref={container}></div>
            </div>

            <div>
                <div className="move-tree-container" ref={move_tree_container} />
            </div>
        </React.Fragment>
    );
}

/*
function ReactGobanPixi(props:ReactGobanProps):JSX.Element {
    return ReactGoban<GobanPixi>(GobanPixi, props);
}
*/

function ReactGobanCanvas(props: ReactGobanProps): JSX.Element {
    return ReactGoban<GobanCanvas>(GobanCanvas, props);
}

function ReactGobanSVG(props: ReactGobanProps): JSX.Element {
    return ReactGoban<GobanSVG>(GobanSVG, props);
}

const react_root = ReactDOM.createRoot(document.getElementById("test-content") as Element);
react_root.render(<Main />);
