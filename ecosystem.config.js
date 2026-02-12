module.exports = {
  apps: [
    {
      name: 'ibis-api',
      script: './packages/api/dist/index.js',
      cwd: '/var/www/ibis',
      instances: 2,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: 3000 },
      max_memory_restart: '500M',
    },
    {
      name: 'ibis-bot',
      script: './packages/bot/dist/index.js',
      cwd: '/var/www/ibis',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', PORT: 3001 },
      max_memory_restart: '300M',
    },
  ],
};
