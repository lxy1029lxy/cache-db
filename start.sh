# PG 数据库
export DB_HOST=192.168.1.102
export DB_PORT=5432
export DB_USER=k12
export DB_PWD=pass_2019
export DB_NAME=k12_db

#redis数据库
export REDIS_HOST=192.168.1.115
export REDIS_PORT=6379
export REDIS_PASS=redis_pass_2018

#设置配置文件的路径
export CONFIG_FILE_PATH=./cacheTable.json

#设置redis缓存时间
export CACHE_TIME=-1

#日志文件的路径
export LOG_PATH=./logs/cacheLog.log

#程序从index.js文件开始运行
node index.js