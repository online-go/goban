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

import { MARK_TYPES } from "./InteractiveBase";
import { OGSConnectivity } from "./OGSConnectivity";
import { GobanConfig } from "../GobanBase";
import { callbacks } from "./callbacks";
import { makeMatrix, StoneStringBuilder } from "../engine";
import { getRelativeEventPosition } from "./canvas_utils";
import { THEMES, THEMES_SORTED } from "./themes";

export const GOBAN_FONT = "Verdana,Arial,sans-serif";
export interface GobanSelectedThemes {
    "board": string;
    "white": string;
    "black": string;
    "removal-graphic": "square" | "x";
    "removal-scale": number;
}
export type LabelPosition =
    | "all"
    | "none"
    | "top-left"
    | "top-right"
    | "bottom-right"
    | "bottom-left";

export interface GobanMetrics {
    width: number;
    height: number;
    mid: number;
    offset: number;
}

/**
 * Goban serves as a base class for our renderers as well as a namespace for various
 * classes, types, and enums.
 *
 * You can't create an instance of a Goban directly, you have to create an instance of
 * one of the renderers, such as GobanSVG.
 */
export abstract class Goban extends OGSConnectivity {
    static THEMES = THEMES;
    static THEMES_SORTED = THEMES_SORTED;

    protected abstract setTheme(themes: GobanSelectedThemes, dont_redraw: boolean): void;

    public parent!: HTMLElement;
    private analysis_scoring_color?: "black" | "white" | string;
    private analysis_scoring_last_position: { i: number; j: number } = { i: NaN, j: NaN };

    constructor(config: GobanConfig, preloaded_data?: GobanConfig) {
        super(config, preloaded_data);

        if (config.display_width && this.original_square_size === "auto") {
            const suppress_redraw = true;
            this.setSquareSizeBasedOnDisplayWidth(config.display_width, suppress_redraw);
        }

        this.on("load", (_config) => {
            if (this.display_width && this.original_square_size === "auto") {
                const suppress_redraw = true;
                this.setSquareSizeBasedOnDisplayWidth(this.display_width, suppress_redraw);
            }
        });
    }
    public override destroy(): void {
        super.destroy();
    }

    protected getSelectedThemes(): GobanSelectedThemes {
        if (callbacks.getSelectedThemes) {
            return callbacks.getSelectedThemes();
        }
        //return {white:'Plain', black:'Plain', board:'Plain'};
        //return {white:'Plain', black:'Plain', board:'Kaya'};
        return {
            "white": "Shell",
            "black": "Slate",
            "board": "Kaya",
            "removal-graphic": "square",
            "removal-scale": 1.0,
        };
    }

    protected putOrClearLabel(x: number, y: number, mode?: "put" | "clear"): boolean {
        let ret = false;
        if (mode == null || typeof mode === "undefined") {
            if (this.analyze_subtool === "letters" || this.analyze_subtool === "numbers") {
                this.label_mark = this.label_character;
                ret = this.toggleMark(x, y, this.label_character, true);
                if (ret === true) {
                    this.incrementLabelCharacter();
                } else {
                    this.setLabelCharacterFromMarks();
                }
            } else {
                this.label_mark = this.analyze_subtool;
                ret = this.toggleMark(x, y, this.analyze_subtool);
            }
        } else {
            if (mode === "put") {
                ret = this.toggleMark(x, y, this.label_mark, this.label_mark.length <= 3, true);
            } else {
                const marks = this.getMarks(x, y);

                for (let i = 0; i < MARK_TYPES.length; ++i) {
                    delete marks[MARK_TYPES[i]];
                }
                this.drawSquare(x, y);
            }
        }

        this.syncReviewMove();
        return ret;
    }

    protected getAnalysisScoreColorAtLocation(
        x: number,
        y: number,
    ): "black" | "white" | string | undefined {
        return this.getMarks(x, y).score;
    }
    protected putAnalysisScoreColorAtLocation(
        x: number,
        y: number,
        color?: "black" | "white" | string,
        sync_review_move: boolean = true,
    ): void {
        const marks = this.getMarks(x, y);
        marks.score = color;
        this.drawSquare(x, y);
        if (sync_review_move) {
            this.syncReviewMove();
        }
    }
    protected putAnalysisRemovalAtLocation(x: number, y: number, removal?: boolean): void {
        const marks = this.getMarks(x, y);
        marks.remove = removal;
        marks.stone_removed = removal;
        this.drawSquare(x, y);
        this.syncReviewMove();
    }

    /** Marks scores on the board when in analysis mode. Note: this will not
     * clear existing scores, this is intentional as I think it's the expected
     * behavior of reviewers */
    public markAnalysisScores() {
        if (this.mode !== "analyze") {
            console.error("markAnalysisScores called when not in analyze mode");
            return;
        }

        /* Clear any previous auto-markings */
        if (this.marked_analysis_score) {
            for (let x = 0; x < this.width; ++x) {
                for (let y = 0; y < this.height; ++y) {
                    if (this.marked_analysis_score[y][x]) {
                        this.putAnalysisScoreColorAtLocation(x, y, undefined, false);
                    }
                }
            }
        }

        this.marked_analysis_score = makeMatrix(this.width, this.height, false);

        const board_state = this.engine.cloneBoardState();

        for (let x = 0; x < this.width; ++x) {
            for (let y = 0; y < this.height; ++y) {
                board_state.removal[y][x] ||= !!this.getMarks(x, y).stone_removed;
            }
        }

        const territory_scoring =
            this.engine.rules === "japanese" || this.engine.rules === "korean";
        const scores = board_state.computeScoringLocations(!territory_scoring);
        for (const color of ["black", "white"] as ("black" | "white")[]) {
            for (const loc of scores[color].locations) {
                this.putAnalysisScoreColorAtLocation(loc.x, loc.y, color, false);
                this.marked_analysis_score[loc.y][loc.x] = true;
            }
        }
        this.syncReviewMove();
    }

    public setSquareSizeBasedOnDisplayWidth(display_width: number, suppress_redraw = false): void {
        let n_squares = Math.max(
            this.bounded_width + +this.draw_left_labels + +this.draw_right_labels,
            this.bounded_height + +this.draw_bottom_labels + +this.draw_top_labels,
        );
        this.display_width = display_width;

        if (isNaN(this.display_width)) {
            console.error("Invalid display width. (NaN)");
            this.display_width = 320;
        }

        if (isNaN(n_squares)) {
            console.error("Invalid n_squares: ", n_squares);
            console.error("bounded_width: ", this.bounded_width);
            console.error("this.draw_left_labels: ", this.draw_left_labels);
            console.error("this.draw_right_labels: ", this.draw_right_labels);
            console.error("bounded_height: ", this.bounded_height);
            console.error("this.draw_top_labels: ", this.draw_top_labels);
            console.error("this.draw_bottom_labels: ", this.draw_bottom_labels);
            n_squares = 19;
        }

        this.setSquareSize(Math.floor(this.display_width / n_squares), suppress_redraw);
    }

    public setLabelPosition(label_position: LabelPosition) {
        this.draw_top_labels = label_position === "all" || label_position.indexOf("top") >= 0;
        this.draw_left_labels = label_position === "all" || label_position.indexOf("left") >= 0;
        this.draw_right_labels = label_position === "all" || label_position.indexOf("right") >= 0;
        this.draw_bottom_labels = label_position === "all" || label_position.indexOf("bottom") >= 0;
        this.setSquareSizeBasedOnDisplayWidth(Number(this.display_width));
        this.redraw(true);
    }

    protected onAnalysisToggleStoneRemoval(ev: MouseEvent | TouchEvent) {
        const pos = getRelativeEventPosition(ev, this.parent);
        this.analysis_removal_last_position = this.xy2ij(pos.x, pos.y, false);
        const { i, j } = this.analysis_removal_last_position;
        const x = i;
        const y = j;

        if (!(x >= 0 && x < this.width && y >= 0 && y < this.height)) {
            return;
        }

        const existing_removal_state = this.getMarks(x, y).stone_removed;

        if (existing_removal_state) {
            this.analysis_removal_state = undefined;
        } else {
            this.analysis_removal_state = true;
        }

        const all_strings = new StoneStringBuilder(this.engine);
        const stone_string = all_strings.getGroup(x, y);

        stone_string.map((loc) => {
            this.putAnalysisRemovalAtLocation(loc.x, loc.y, this.analysis_removal_state);
        });

        // If we have any scores on the board, we assume we are interested in those
        // and we recompute scores, updating
        const have_any_scores = this.marked_analysis_score?.some((row) => row.includes(true));

        if (have_any_scores) {
            this.markAnalysisScores();
        }
    }

    /** Clears any analysis scores on the board */
    public clearAnalysisScores() {
        delete this.marked_analysis_score;
        if (this.mode !== "analyze") {
            console.error("clearAnalysisScores called when not in analyze mode");
            return;
        }
        for (let x = 0; x < this.width; ++x) {
            for (let y = 0; y < this.height; ++y) {
                this.putAnalysisScoreColorAtLocation(x, y, undefined, false);
            }
        }
        this.syncReviewMove();
    }

    public setSquareSize(new_ss: number, suppress_redraw = false): void {
        const redraw = this.square_size !== new_ss && !suppress_redraw;
        this.square_size = Math.max(new_ss, 1);
        if (redraw) {
            this.redraw(true);
        }
    }

    public setStoneFontScale(new_ss: number, suppress_redraw = false): void {
        const redraw = this.stone_font_scale !== new_ss && !suppress_redraw;
        this.stone_font_scale = new_ss;
        if (redraw) {
            this.redraw(true);
        }
    }

    public computeMetrics(): GobanMetrics {
        if (!this.square_size || this.square_size <= 0) {
            this.square_size = 12;
        }

        const ret = {
            width:
                this.square_size *
                (this.bounded_width + +this.draw_left_labels + +this.draw_right_labels),
            height:
                this.square_size *
                (this.bounded_height + +this.draw_top_labels + +this.draw_bottom_labels),
            mid: this.square_size / 2,
            offset: 0,
        };

        if (this.square_size % 2 === 0) {
            ret.mid -= 0.5;
            ret.offset = 0.5;
        }

        return ret;
    }

    protected onAnalysisScoringStart(ev: MouseEvent | TouchEvent) {
        const pos = getRelativeEventPosition(ev, this.parent);
        this.analysis_scoring_last_position = this.xy2ij(pos.x, pos.y, false);

        {
            const x = this.analysis_scoring_last_position.i;
            const y = this.analysis_scoring_last_position.j;
            if (!(x >= 0 && x < this.width && y >= 0 && y < this.height)) {
                return;
            }
        }

        const existing_color = this.getAnalysisScoreColorAtLocation(
            this.analysis_scoring_last_position.i,
            this.analysis_scoring_last_position.j,
        );

        if (existing_color === this.analyze_subtool) {
            this.analysis_scoring_color = undefined;
        } else {
            this.analysis_scoring_color = this.analyze_subtool;
        }

        this.putAnalysisScoreColorAtLocation(
            this.analysis_scoring_last_position.i,
            this.analysis_scoring_last_position.j,
            this.analysis_scoring_color,
        );

        /* clear hover */
        if (this.__last_pt.valid) {
            const last_hover = this.last_hover_square;
            delete this.last_hover_square;
            if (last_hover) {
                this.drawSquare(last_hover.x, last_hover.y);
            }
        }
        this.__last_pt = this.xy2ij(-1, -1);
        this.drawSquare(
            this.analysis_scoring_last_position.i,
            this.analysis_scoring_last_position.j,
        );
    }
    protected onAnalysisScoringMove(ev: MouseEvent | TouchEvent) {
        const pos = getRelativeEventPosition(ev, this.parent);
        const cur = this.xy2ij(pos.x, pos.y);

        {
            const x = cur.i;
            const y = cur.j;
            if (!(x >= 0 && x < this.width && y >= 0 && y < this.height)) {
                return;
            }
        }

        if (
            cur.i !== this.analysis_scoring_last_position.i ||
            cur.j !== this.analysis_scoring_last_position.j
        ) {
            this.analysis_scoring_last_position = cur;
            this.putAnalysisScoreColorAtLocation(cur.i, cur.j, this.analysis_scoring_color);
        }
    }
}
