import historyApiFallback from 'connect-history-api-fallback'
import express from 'express'
import { task, src, dest, lastRun, parallel, series, watch } from 'gulp'
import loadPlugins from 'gulp-load-plugins'
import path from 'path'
import rimraf from 'rimraf'
import webpack from 'webpack'
import WebpackDevMiddleware from 'webpack-dev-middleware'
import WebpackHotMiddleware from 'webpack-hot-middleware'

import sh from '../sh'
import config from '../../config'
import gulpComponentMenu from '../plugins/gulp-component-menu'
import gulpExampleMenu from '../plugins/gulp-example-menu'
import gulpExampleSources from '../plugins/gulp-example-source'
import gulpReactDocgen from '../plugins/gulp-react-docgen'

const { paths } = config
const g = loadPlugins()
const { colors, log, PluginError } = g.util

const handleWatchChange = e => log(`File ${e.path} was ${e.type}, running tasks...`)

// ----------------------------------------
// Clean
// ----------------------------------------

task('clean:docs:component-info', (cb) => {
  rimraf(paths.docsSrc('componentInfo'), cb)
})

task('clean:docs:component-menu', (cb) => {
  rimraf(paths.docsSrc('componentMenu.json'), cb)
})

task('clean:docs:dist', (cb) => {
  rimraf(paths.docsDist(), cb)
})

task('clean:docs:example-menus', (cb) => {
  rimraf(paths.docsSrc('exampleMenus'), cb)
})

task('clean:docs:example-sources', (cb) => {
  rimraf(paths.docsSrc('exampleSources.json'), cb)
})

task(
  'clean:docs',
  parallel(
    'clean:docs:component-info',
    'clean:docs:component-menu',
    'clean:docs:dist',
    'clean:docs:example-menus',
    'clean:docs:example-sources',
  ),
)

// ----------------------------------------
// Build
// ----------------------------------------

const componentsSrc = [
  `${paths.src()}/addons/*/*.js`,
  `${paths.src()}/behaviors/*/*.js`,
  `${paths.src()}/elements/*/*.js`,
  `${paths.src()}/collections/*/*.js`,
  `${paths.src()}/modules/*/*.js`,
  `${paths.src()}/views/*/*.js`,
  '!**/index.js',
]

const examplesSectionsSrc = `${paths.docsSrc()}/examples/*/*/*/index.js`
const examplesSrc = `${paths.docsSrc()}/examples/*/*/*/!(*index).js`

task('build:docs:cname', (cb) => {
  sh(`echo react.semantic-ui.com > ${paths.docsDist('CNAME')}`, cb)
})

task('build:docs:less:src', () => {
  const suiSrc = [
    `${paths.base('node_modules/semantic-ui-less')}/**/*`,
    `!${paths.base('node_modules/semantic-ui-less')}/**/*.js`,
  ]
  const destDir = paths.docsSrc('assets/less')

  const isThemeConfig = file => file.basename.startsWith('theme.config')
  const isSiteDirectory = file => file.dirname.includes('_site')
  const isThemeLESS = file => file.basename === 'theme.less'

  return src(suiSrc, { since: lastRun('build:docs:less:src') })
    .pipe(g.if(isThemeConfig, g.rename({ extname: '' })))
    .pipe(g.if(isSiteDirectory, g.rename((file) => {
      // eslint-disable-next-line no-param-reassign
      file.dirname = file.dirname.replace('_site', 'site')
    })))
    // TODO remove once semantic-ui-less 3.2.3 ships
    // make semantic-ui-less compatible with less 3.x
    .pipe(g.if(isThemeConfig, g.replace('import "theme', 'import (multiple) "theme', { skipBinary: false })))
    .pipe(g.if(isThemeLESS, g.replace('import url', 'import (css) url')))
    .pipe(dest(destDir))
})

task('build:docs:less:dist', () => {
  const lesssSrc = `${paths.docsSrc('assets/less')}/**/*`
  const lessDest = dest(paths.docsDist('assets/less'))

  return src(lesssSrc, { since: lastRun('build:docs:less:dist') }).pipe(lessDest)
})

task('build:docs:docgen', () =>
  src(componentsSrc, { since: lastRun('build:docs:docgen') })
    .pipe(gulpReactDocgen())
    .pipe(dest(paths.docsSrc('componentInfo'))),
)

task('build:docs:component-menu', () =>
  src(componentsSrc, { since: lastRun('build:docs:component-menu') })
    .pipe(gulpComponentMenu())
    .pipe(dest(paths.docsSrc())),
)

task('build:docs:example-menu', () =>
  src(examplesSectionsSrc, { since: lastRun('build:docs:example-menu') })
    .pipe(gulpExampleMenu())
    .pipe(dest(paths.docsSrc('exampleMenus'))),
)

task('build:docs:example-sources', () =>
  src(examplesSrc, { since: lastRun('build:docs:example-sources') })
    .pipe(gulpExampleSources())
    .pipe(dest(paths.docsSrc())),
)

task(
  'build:docs:json',
  parallel(
    'build:docs:docgen',
    'build:docs:component-menu',
    'build:docs:example-menu',
    'build:docs:example-sources',
  ),
)

task('build:docs:html', () => src(paths.docsSrc('404.html')).pipe(dest(paths.docsDist())))

task('build:docs:images', () =>
  src(`${paths.docsPublic()}/**/*.{png,jpg,gif}`).pipe(dest(paths.docsDist())),
)

task('build:docs:toc', (cb) => {
  sh(`doctoc ${paths.base('.github/CONTRIBUTING.md')} --github --maxlevel 4`, cb)
})

task('build:docs:webpack', (cb) => {
  const webpackConfig = require('../../webpack.config.babel').default
  const compiler = webpack(webpackConfig)

  compiler.run((err, stats) => {
    const { errors, warnings } = stats.toJson()

    log(stats.toString(config.compiler_stats))

    if (err) {
      log('Webpack compiler encountered a fatal error.')
      throw new PluginError('webpack', err.toString())
    }
    if (errors.length > 0) {
      log('Webpack compiler encountered errors.')
      throw new PluginError('webpack', errors.toString())
    }
    if (warnings.length > 0 && config.compiler_fail_on_warning) {
      throw new PluginError('webpack', warnings.toString())
    }

    cb(err)
  })
})

task(
  'build:docs',
  series(
    parallel('build:docs:toc', 'build:docs:less:src'),
    'clean:docs',
    parallel('build:docs:less:dist', 'build:docs:json', 'build:docs:html', 'build:docs:images'),
    'build:docs:webpack',
  ),
)

// ----------------------------------------
// Deploy
// ----------------------------------------

task('deploy:docs', (cb) => {
  const relativePath = path.relative(process.cwd(), paths.docsDist())
  sh(`gh-pages -d ${relativePath} -m "deploy docs [ci skip]"`, cb)
})

// ----------------------------------------
// Serve
// ----------------------------------------

task('serve:docs', (cb) => {
  const app = express()
  const webpackConfig = require('../../webpack.config.babel').default
  const compiler = webpack(webpackConfig)

  app
    .use(
      historyApiFallback({
        verbose: false,
      }),
    )

    .use(
      WebpackDevMiddleware(compiler, {
        publicPath: webpackConfig.output.publicPath,
        contentBase: paths.docsPublic(),
        hot: true,
        quiet: false,
        noInfo: true, // must be quiet for hot middleware to show overlay
        lazy: false,
        stats: config.compiler_stats,
      }),
    )

    .use(WebpackHotMiddleware(compiler))

    .use(express.static(paths.docsDist()))

    .listen(config.server_port, config.server_host, () => {
      log(colors.yellow('Server running at http://%s:%d'), config.server_host, config.server_port)
      cb()
    })
})

// ----------------------------------------
// Watch
// ----------------------------------------

task('watch:docs', (cb) => {
  // rebuild component info
  watch(componentsSrc, series('build:docs:docgen')).on('change', handleWatchChange)

  // rebuild example menus
  watch(examplesSectionsSrc, series('build:docs:example-menu')).on('change', handleWatchChange)

  // rebuild example sources
  watch(examplesSrc, series('build:docs:example-sources')).on('change', handleWatchChange)

  // rebuild images
  watch(`${config.paths.docsPublic()}/**/*.{png,jpg,gif}`, series('build:docs:images')).on(
    'change',
    handleWatchChange,
  )
  cb()
})

// ----------------------------------------
// Default
// ----------------------------------------

task('docs', series('build:docs', 'serve:docs', 'watch:docs'))
