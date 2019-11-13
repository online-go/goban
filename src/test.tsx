/*
 * Copyright 2012-2019 Online-Go.com
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

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { GobanCore, GobanConfig, GobanHooks } from './GobanCore';
//import { GobanPixi } from './GobanPixi';
import { GobanCanvas, GobanCanvasConfig } from './GobanCanvas';
import { EventEmitter } from 'eventemitter3';

let stored_config:GobanConfig = {};
try {
    stored_config = JSON.parse(localStorage.getItem('config') || '{}');
} catch (e) {
}

let base_config:GobanConfig = Object.assign({
    "interactive": true,
    "mode": "puzzle",
    //"player_id": 0,
    //"server_socket": null,
    "square_size": 25,
    "original_sgf": `
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
}, stored_config);





const hooks:GobanHooks = {
    //getCoordinateDisplaySystem: () => '1-1',
    getCoordinateDisplaySystem: () => 'A1',
    getCDNReleaseBase: () => '',
};
GobanCore.setHooks(hooks);


function save() {
    localStorage.setItem("config", JSON.stringify(base_config));
}

function clear() {
    localStorage.remove("config");
}
(window as any)['clear'] = clear;
/*
            "getPuzzlePlacementSetting": () => {
                return {"mode": "play"};
            },
            */

let fiddler = new EventEmitter();

function Main():JSX.Element {
    let [_update, _setUpdate ] = React.useState(1);
    function forceUpdate() {
        _setUpdate(_update + 1);
    }
    function redraw() {
        save();
        forceUpdate();
        fiddler.emit('redraw');
    }

    return (
    <div>
    <div>
        <div className='inline-block'>
            <div className='setting'>
                <span>Square size:</span>
                <input type='range'
                    value={base_config.square_size as number}
                    onChange={(ev) => {
                        let ss = Math.max(1, parseInt(ev.target.value));
                        //console.log(ss);
                        if (!ss) {
                            ss = 1;
                        }
                        base_config.square_size = ss;
                        forceUpdate();
                        fiddler.emit('setSquareSize', ss);
                    }} />
            </div>

            <div className='setting'>
                <span>Top labels:</span>
                <input type='checkbox'
                    checked={base_config.draw_top_labels}
                    onChange={(ev) => {
                        base_config.draw_top_labels = ev.target.checked;
                        redraw();
                    }} />
            </div>


            <div className='setting'>
                <span>Left labels:</span>
                <input type='checkbox'
                    checked={base_config.draw_left_labels}
                    onChange={(ev) => {
                        base_config.draw_left_labels = ev.target.checked;
                        redraw();
                    }} />
            </div>
            <div className='setting'>
                <span>Right labels:</span>
                <input type='checkbox'
                    checked={base_config.draw_right_labels}
                    onChange={(ev) => {
                        base_config.draw_right_labels = ev.target.checked;
                        redraw();
                    }} />
            </div>
            <div className='setting'>
                <span>Bottom labels:</span>
                <input type='checkbox'
                    checked={base_config.draw_bottom_labels}
                    onChange={(ev) => {
                        base_config.draw_bottom_labels = ev.target.checked;
                        redraw();
                    }} />
            </div>

        </div>

        <div className='inline-block'>
            <div className='setting'>
                <span>Top bounds:</span>
                <input type='range' min="0" max="18" step="1"
                    value={base_config.bounds?.top}
                    onChange={(ev) => {
                        if (base_config.bounds) {
                            base_config.bounds.top = parseInt(ev.target.value);
                        }
                        redraw();
                    }} />
            </div>
            <div className='setting'>
                <span>Left bounds:</span>
                <input type='range' min="0" max="18" step="1"
                    value={base_config.bounds?.left}
                    onChange={(ev) => {
                        if (base_config.bounds) {
                            base_config.bounds.left = parseInt(ev.target.value);
                        }
                        redraw();
                    }} />
            </div>
            <div className='setting'>
                <span>Right bounds:</span>
                <input type='range' min="0" max="18" step="1"
                    value={base_config.bounds?.right}
                    onChange={(ev) => {
                        if (base_config.bounds) {
                            base_config.bounds.right = parseInt(ev.target.value);
                        }
                        redraw();
                    }} />
            </div>
            <div className='setting'>
                <span>Bottom bounds:</span>
                <input type='range' min="0" max="18" step="1"
                    value={base_config.bounds?.bottom}
                    onChange={(ev) => {
                        if (base_config.bounds) {
                            base_config.bounds.bottom = parseInt(ev.target.value);
                        }
                        redraw();
                    }} />
            </div>
        </div>
    </div>


        {/*false && <ReactGobanPixi /> */}
        {[
        //1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20
        //1,2,3,4,5,6,7,8,9,10,11,12
        ].map((_, idx) => <ReactGobanCanvas key={idx} />)}
        {true && <ReactGobanCanvas /> }

    </div>
    );
}


interface ReactGobanProps {
}

function ReactGoban<GobanClass extends GobanCore>(ctor:{new(x:GobanCanvasConfig): GobanClass}, props:ReactGobanProps):JSX.Element {
    const container = React.useRef(null);
    const move_tree_container = React.useRef(null);
    let goban:GobanCore;

    React.useEffect(() => {
        let config:GobanCanvasConfig = Object.assign({}, base_config, {
            "board_div": container.current || undefined,
            "move_tree_container": move_tree_container.current || undefined,
        });

        goban = new ctor(config);

        fiddler.on('setSquareSize', (ss) => {
            const start = Date.now();
            goban.setSquareSize(ss)
            const end = Date.now();
            console.log("SSS time: ", end - start);
        });

        fiddler.on('redraw', () => {
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

        let i=0;
        let start = Date.now();
        let interval = setInterval(() => {
            i++;
            if (i >= 300) {
                if (i === 300) {
                    let end = Date.now();
                    console.log("Done in ", end - start);
                }
                clearInterval(interval);
                return;
            }
            goban.engine.place(Math.floor(i / 19), Math.floor(i % 19));
            //goban.redraw(true);
        }, 1);


        return () => {
            goban.destroy();
        };
    }, [container]);



    return (
        <React.Fragment>
            <div className='Goban'>
                <div ref={container}>
                </div>
            </div>

            <div>
                <div className='move-tree-container' ref={move_tree_container} />
            </div>
        </React.Fragment>
    );
}

/*
function ReactGobanPixi(props:ReactGobanProps):JSX.Element {
    return ReactGoban<GobanPixi>(GobanPixi, props);
}
*/

function ReactGobanCanvas(props:ReactGobanProps):JSX.Element {
    return ReactGoban<GobanCanvas>(GobanCanvas, props);
}


ReactDOM.render(<Main />, document.getElementById("test-content"));
