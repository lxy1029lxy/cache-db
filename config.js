const { Client } = require('pg');
const fs =require('fs');
const Redis =require('ioredis');
const log4js = require("log4js");

/**
 * 检查环境变量
 * @param { string } key 
 */
function checkEnv(key) {
    if(!process.env[key]){
        logger().error(`环境变量[${key}]不存在, 请检查环境变量配置!`)
        throw `环境变量[${key}]不存在, 请检查环境变量配置!`
    }
    return process.env[key];
  }

/**
 * 检查配置文件
 */
function checkConfigFile(){
    fs.exists(checkEnv('CONFIG_FILE_PATH'), function(exists) {
        if (!exists){
            logger().error(`文件路径为${checkEnv('CONFIG_FILE_PATH')}的配置文件不存在!`)
            throw `文件路径为${checkEnv('CONFIG_FILE_PATH')}的配置文件不存在!`
        }
    })
    const cacheTable=require(checkEnv('CONFIG_FILE_PATH'))
    return cacheTable
}

/**
 * 检查配置文件的配置项
 * @param { object } obj 
 * @returns { Promise<table:string,key_prefix:string,value_field:Array,value_type:string,key_field?:Array,expire?:number> }
 */
async function checkCacheObj(obj){
    //缓存项的必填项
    const table = 'table' in obj? obj['table']:false
    const key_prefix ='key_prefix' in obj?obj['key_prefix']:false
    const value_field ='value_field' in obj? obj['value_field']:false
    const value_type ='value_type' in obj? obj['value_type']:false
    //缓存项的选填项
    let expire = 'expire' in obj?obj['expire']:-1
    const key_field = 'key_field' in obj?obj['key_field']:[]

    if(key_field.length >0 && expire === -1){
        if(key_field.length >1){
            logger().warn(`当前表${table},value_type为${value_type}的key_field列表中有多个值，必须设置缓存时间,然后重启程序,否则系统默认设置缓存时间为6个小时`)
            expire = 60*60*6
        }else if(key_field.indexOf('id')===-1){
            logger().warn(`当前表${table},value_type为${value_type}的key_field(${key_field})列表不为id，必须设置缓存时间,然后重启程序,否则系统默认设置缓存时间为6个小时`)
            expire = 60*60*6
        }
    }
    if(!table||!key_prefix||!value_field||!value_type){
        throw '缓存项不完整，请检查配置文件!'
    }
    const val ={
        table:table,
        key_prefix:key_prefix,
        value_field:value_field,
        value_type,value_type,
        expire,expire,
        key_field,key_field
    }
    return val
}


/**
 * 连接postgres
 * @returns { Client }
 */
async function pg(){
    //postgres 数据库配置
    const obj ={
        host: checkEnv('DB_HOST'),
        port: checkEnv('DB_PORT'),
        user: checkEnv('DB_USER'),
        password: checkEnv('DB_PWD'),
        database: checkEnv('DB_NAME'),
        connectionTimeoutMillis: 10 * 60 * 1000, // 10m
        idleTimeoutMillis: 10 * 1000, // 10s
        max: 50,
    }
    //设置pg数据库连接配置
    const client =new Client(obj)
    client.connect(function(err){
        if(err){
            logger().warn('pg数据库连接失败,失败原因:',err)
        }
    })
    return client
}

/**
 * 连接redis
 */
async function ioredis(){
    const obj = {
        port: checkEnv('REDIS_PORT'), // Redis port
        host: checkEnv('REDIS_HOST'), // Redis host
        password: checkEnv('REDIS_PASS'),
        db: 0,
      }
    const redis =new Redis(obj)
    return redis
}

/**
 * 用于打印日志文件
 */
function logger(){
    log4js.configure({
    appenders: { 
            console:{//记录器1:输出到控制台
                type : 'console',
            },
            file: {//记录器2:输出到文件
                type: "file", filename: checkEnv('LOG_PATH') 
            } 
        },
  categories: { default: { appenders: ["file","console"], level: "info" } }
});
    const logger = log4js.getLogger("cheese");
    return logger
}


module.exports ={ 
    checkEnv,
    pg,
    checkConfigFile,
    checkCacheObj,
    ioredis,
    logger:logger()
}

