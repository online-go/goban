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
import {
    Route,
    Routes,
    BrowserRouter,
    Link,
    //Navigate,
    //useNavigate,
} from "react-router-dom";

import { EventEmitter } from "eventemitter3";
import {
    GobanConfig,
    ColoredCircle,
    GobanCanvas,
    CanvasRendererGobanConfig,
    SVGRenderer,
    SVGRendererGobanConfig,
    THEMES,
    Goban,
} from "../src";

import { MoveTreePenMarks } from "../src/engine/MoveTree";

let stored_config: GobanConfig = {};
try {
    stored_config = JSON.parse(localStorage.getItem("config") || "{}");
} catch (e) {}

Goban.setCallbacks({
    getSelectedThemes: () => ({
        "board": "Kaya",
        //"board": "Anime",

        "white": "Plain",
        "black": "Plain",
        //white: "Glass",
        //black: "Glass",
        //white: "Worn Glass",
        //black: "Worn Glass",
        //white: "Night",
        //black: "Night",
        //white: "Shell",
        //black: "Slate",
        //white: "Anime",
        //black: "Anime",
        //white: "Custom",
        //black: "Custom",
        "removal-graphic": "square",
        "removal-scale": 1.0,
    }),

    customWhiteStoneUrl: () => {
        return "https://cdn.online-go.com/goban/anime_white.svg";
    },
    customBlackStoneUrl: () => {
        return "https://cdn.online-go.com/goban/anime_black.svg";
    },
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

Goban.setCallbacks({
    //getCoordinateDisplaySystem: () => "1-1",
    getCoordinateDisplaySystem: () => "A1",
    getCDNReleaseBase: () => "",
});

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

function GobanTestPage(): JSX.Element {
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
                        <span>Stone font scale:</span>
                        <input
                            type="range"
                            value={base_config.stone_font_scale as number}
                            min="0.1"
                            max="2"
                            step="0.1"
                            onChange={(ev) => {
                                let ss = parseFloat(ev.target.value);
                                if (!ss) {
                                    ss = 1;
                                }
                                base_config.stone_font_scale = ss;
                                forceUpdate();
                                fiddler.emit("setStoneFontScale", ss);
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
            {svg_or_canvas === "svg" ? <ReactGobanSVG /> : <ReactGobanCanvas />}
        </div>
    );
}

interface ReactGobanProps {}

function ReactGoban<GobanClass extends Goban>(
    ctor: { new (x: CanvasRendererGobanConfig | SVGRendererGobanConfig): GobanClass },
    props: ReactGobanProps,
): JSX.Element {
    const [elapsed, setElapsed] = React.useState(0);
    const container = React.useRef(null);
    const move_tree_container = React.useRef(null);
    let goban: Goban;

    React.useEffect(() => {
        const config: CanvasRendererGobanConfig | SVGRendererGobanConfig = Object.assign(
            {},
            base_config,
            {
                board_div: container.current || undefined,
                move_tree_container: move_tree_container.current || undefined,
            },
        );

        goban = new ctor(config);

        goban.showMessage("loading", { foo: "bar" }, 1000);

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

        fiddler.on("setStoneFontScale", (ss) => {
            const start = Date.now();
            goban.setStoneFontScale(ss);
            const end = Date.now();
            console.log("SFS time: ", end - start);
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
        // const NUM_MOVES = 20;
        const interval = setInterval(() => {
            i++;
            if (i >= NUM_MOVES) {
                if (i === NUM_MOVES) {
                    const end = Date.now();
                    console.log("Done in ", end - start);
                    setElapsed(end - start);

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
                    goban.setSubscriptMark(16, 12, "sub", true);
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

                    //goban.drawPenMarks(marks);
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
            <StoneSamples />

            {elapsed > 0 && <div>Elapsed: {elapsed}ms</div>}
            <div className="Goban">
                <div ref={container}></div>
            </div>
            <div>
                <div className="move-tree-container" ref={move_tree_container} />
            </div>
        </React.Fragment>
    );
}

function StoneSamples(): JSX.Element {
    const div = React.useRef(null);

    React.useEffect(() => {
        if (!div.current) {
            console.log("no current");
            return;
        }

        {
            const white_theme = "Shell";
            const black_theme = "Slate";
            //const white_theme = "Glass";
            //const black_theme = "Glass";
            //const white_theme = "Worn Glass";
            //const black_theme = "Worn Glass";
            //const white_theme = "Night";
            //const black_theme = "Night";
            //const white_theme = "Plain";
            //const black_theme = "Plain";
            const radius = 80;
            const cx = radius;
            const cy = radius;
            const size = radius * 2;

            const foo = document.createElement("div");

            (div.current as any)?.appendChild(foo);

            {
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("width", size.toFixed(0));
                svg.setAttribute("height", size.toFixed(0));
                const theme = new THEMES["black"][black_theme]();
                const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
                svg.appendChild(defs);

                const black_stones = theme.preRenderBlackSVG(defs, radius, 123, () => {});

                const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
                svg.appendChild(g);
                //for (let i = 0; i < black_stones.length; i++) {
                for (let i = 0; i < 1; i++) {
                    theme.placeBlackStoneSVG(
                        g,
                        undefined,
                        black_stones[i],
                        cx + i * radius * 2,
                        cy,
                        radius,
                    );
                }

                foo.appendChild(svg);
            }

            {
                const theme = new THEMES["white"][white_theme]();
                const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
                const white_stones = theme.preRenderWhiteSVG(defs, radius, 123, () => {});

                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("width", (white_stones.length * size).toFixed(0));
                svg.setAttribute("height", size.toFixed(0));
                svg.appendChild(defs);

                const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
                svg.appendChild(g);
                for (let i = 0; i < white_stones.length; i++) {
                    //for (let i = 0; i < 1; i++) {
                    theme.placeWhiteStoneSVG(
                        g,
                        undefined,
                        white_stones[i],
                        cx + i * radius * 2,
                        cy,
                        radius,
                    );
                }

                foo.appendChild(svg);
            }
        }

        {
            const radius = 20;
            const cx = radius;
            const cy = radius;
            const size = radius * 2;

            for (const black_theme in THEMES["black"]) {
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("width", size.toFixed(0));
                svg.setAttribute("height", size.toFixed(0));
                const theme = new THEMES["black"][black_theme]();
                const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
                svg.appendChild(defs);

                const black_stones = theme.preRenderBlackSVG(defs, radius, 123, () => {});

                const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
                svg.appendChild(g);
                //for (let i = 0; i < black_stones.length; i++) {
                for (let i = 0; i < 1; i++) {
                    theme.placeBlackStoneSVG(
                        g,
                        undefined,
                        black_stones[i],
                        cx + i * radius * 2,
                        cy,
                        radius,
                    );
                }

                const label = document.createElement("label");
                label.textContent = black_theme;
                label.setAttribute(
                    "style",
                    "display: inline-block; width: 100px; margin-right: 1rem; text-align: right;",
                );
                const d = document.createElement("span");
                d.appendChild(label);
                d.appendChild(svg);

                (div.current as any)?.appendChild(d);
            }

            const br = document.createElement("br");
            (div.current as any)?.appendChild(br);

            for (const white_theme in THEMES["white"]) {
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("width", size.toFixed(0));
                svg.setAttribute("height", size.toFixed(0));
                const theme = new THEMES["white"][white_theme]();
                const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
                svg.appendChild(defs);

                const white_stones = theme.preRenderWhiteSVG(defs, radius, 123, () => {});

                const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
                svg.appendChild(g);
                //for (let i = 0; i < white_stones.length; i++) {
                for (let i = 0; i < 1; i++) {
                    theme.placeWhiteStoneSVG(
                        g,
                        undefined,
                        white_stones[i],
                        cx + i * radius * 2,
                        cy,
                        radius,
                    );
                }

                const label = document.createElement("label");
                label.textContent = white_theme;
                label.setAttribute(
                    "style",
                    "display: inline-block; width: 100px; margin-right: 1rem; text-align: right;",
                );
                const d = document.createElement("span");
                d.appendChild(label);
                d.appendChild(svg);

                (div.current as any)?.appendChild(d);
            }
        }
    }, [div]);

    return <div ref={div} />;
}

function ReactGobanCanvas(props: ReactGobanProps): JSX.Element {
    return ReactGoban<GobanCanvas>(GobanCanvas, props);
}

function ReactGobanSVG(props: ReactGobanProps): JSX.Element {
    return ReactGoban<SVGRenderer>(SVGRenderer, props);
}

function Main(props: { children: any }): JSX.Element {
    return <div className="Main">{props.children}</div>;
}

//import { LiveProvider, LiveEditor, LivePreview, LiveError } from "react-live";

const scope = {
    Goban: SVGRenderer,
};

const code = `
new Goban({
    board_div: goban_container
});
`;

function Examples(): JSX.Element {
    /*
    return (
        <div className="Default">
            <LiveProvider code={code} scope={scope} noInline={true} disabled={true}>
                <div className="grid grid-cols-2 gap-4">
                    <LiveEditor className="font-mono" />
                    <LivePreview />
                    <LiveError className="text-red-800 bg-red-100 mt-2" />
                </div>
            </LiveProvider>
            <div id="goban-output-div" />
        </div>
    );
    */
    return (
        <div className="Default">
            <CodeExample source={code} scope={scope} />
        </div>
    );
}

function CodeExample({
    source,
    scope,
}: {
    source: string;
    scope: { [key: string]: any };
}): JSX.Element {
    const [output, setOutput] = React.useState(null);
    const goban_container = React.useRef(null);

    React.useEffect(() => {
        if (!goban_container.current) {
            return;
        }

        try {
            const context = { ...scope, goban_container: goban_container.current };

            setOutput(
                Function(
                    ...Object.keys(context),
                    '"use strict"; ' + source,
                )(...Object.values(context)),
            );
        } catch (e) {
            console.error(e);
        }
    }, [source, scope, goban_container]);

    return (
        <div className="CodeExample">
            <pre className="code">{code}</pre>
            <div ref={goban_container} className="Goban"></div>
            <div>{output}</div>
        </div>
    );
}

export function LeftNav(): JSX.Element {
    return (
        <div className="LeftNav">
            <Link to="/">Home</Link>
            <Link to="/examples">Examples</Link>
            <Link to="/test-page">Test page</Link>
        </div>
    );
}

export const routes = (
    <>
        <BrowserRouter>
            <Main>
                <LeftNav />
                <div className="Main-content">
                    <Routes>
                        <Route path="/test-page" element={<GobanTestPage />} />
                        <Route path="/examples" element={<Examples />} />
                        <Route path="/" element={<GobanTestPage />} />
                    </Routes>
                </div>
            </Main>
        </BrowserRouter>
    </>
);

const react_root = ReactDOM.createRoot(document.getElementById("test-content") as Element);
//react_root.render(<GobanTestPage />);
//react_root.render(<React.StrictMode>{routes}</React.StrictMode>);
react_root.render(routes);
