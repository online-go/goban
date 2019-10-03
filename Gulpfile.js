'use strict';

const spawn        = require('child_process').spawn;
const fs           = require('fs');
const gulp         = require('gulp');
const execSync     = require('child_process').execSync;
const livereload   = require('gulp-livereload');
const gulpTsLint   = require('gulp-tslint');
const tslint       = require('tslint');

let ts_sources = ['src/**/*.ts', 'src/**/*.tsx'];

gulp.task('watch_lib_js', watch_lib_js);
gulp.task('watch_html', watch_html);
gulp.task('livereload-server', livereload_server);
gulp.task('background_tsc', background_tsc);
gulp.task('watch_tslint', watch_tslint);
gulp.task('tslint', lint);
gulp.task('default', 
    gulp.parallel(
        "livereload-server", 
        "background_tsc", 
        "watch_lib_js", 
        "watch_html", 
        "watch_tslint"
    )
);


function reload(done) {
    livereload.reload();
    done();
}
function watch_lib_js(done) { 
    gulp.watch(['lib/*.js'], reload);
    done(); 
}
function watch_html(done) { 
    gulp.watch(['test/*.html'], reload);
    done(); 
}
function livereload_server(done) { 
    livereload.listen(35716);
    done(); 
}
function watch_tslint(done) { 
    gulp.watch(ts_sources, lint);
    done();
};

let lint_debounce = null;
function lint(done) {
    if (lint_debounce) {
        done();
        return;
    }

    lint_debounce = setTimeout(()=>{
        lint_debounce = null;
        var program = tslint.Linter.createProgram("./tsconfig.json");

        gulp.src(ts_sources, {base: '.'})
        .pipe(gulpTsLint({
            //formatter: "prose",
            configuration: "./tslint.json",
            formatter: "stylish",
            program: program,
        }))
        .pipe(gulpTsLint.report({
            emitError: false,
            reportLimit: 0,
            summarizeFailureOutput: false
        }))
    }, 50)
    done();
}

function background_tsc(done) {
    function spawn_tsc() {
        const env = process.env;
        const tsc = spawn('npm', ['run', 'build-watch'])

        tsc.stdout.on('data', o => process.stdout.write(o))
        tsc.stderr.on('data', o => process.stderr.write(o))
        tsc.on('exit', spawn_tsc);
    }
    spawn_tsc();

    done()
}
