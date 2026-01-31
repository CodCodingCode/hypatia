const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: [path.join(__dirname, 'src/index.jsx')],
  bundle: true,
  outfile: path.join(__dirname, 'dist/content.bundle.js'),
  format: 'iife',
  target: ['chrome91'],
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"'
  },
  loader: {
    '.jsx': 'jsx',
    '.js': 'js',
    '.css': 'css'
  }
};

async function build() {
  try {
    if (isWatch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      await esbuild.build(buildOptions);
      console.log('Build complete!');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
