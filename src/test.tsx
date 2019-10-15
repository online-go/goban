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
import { GobanPixi as Goban } from './GobanPixi';


const Main = (
    <div>
        <ReactGoban />
    </div>
);

function ReactGoban(props:{}):JSX.Element {
    const container = React.useRef(null);
    let goban:Goban;

    React.useEffect(() => {
        goban = new Goban({
            "board_div": container.current,
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
            `
        })

        return () => {
            goban.destroy();
        }
    }, [container]);


    return (
        <div>
            <div ref={container}>
            </div>
        </div>
    );
}


ReactDOM.render(Main, document.getElementById("test-content"));
