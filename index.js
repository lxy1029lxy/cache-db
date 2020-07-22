//@ts-check
const config =require('./config')
const { Client } =require('pg')
const { checkCacheObj } = require('./config')

/**
 * 用于检查触发器函数的函数
 * @param { Client } client 
 * @returns {Promise<Boolean>}
 */
async function checkTriggerFunc(client){
    //查数据库中的pg_proc表，这是一张pg用于保存函数的系统表
    const { rows }=await client.query("select * from pg_proc where proname='notify_change';")
    if(rows.length === 0){
        //如果没有查到记录，那么说明触发器函数不存在
        const create_trigger_func =`CREATE OR REPLACE FUNCTION notify_change() RETURNS TRIGGER AS $$
                                    BEGIN
                                        IF    (TG_OP = 'INSERT') THEN 
                                        PERFORM pg_notify(TG_RELNAME || '_chan', 'I' || NEW.id); RETURN NEW;
                                        ELSIF (TG_OP = 'UPDATE') THEN 
                                        PERFORM pg_notify(TG_RELNAME || '_chan', 'U' || NEW.id); RETURN NEW;
                                        ELSIF (TG_OP = 'DELETE') THEN 
                                        PERFORM pg_notify(TG_RELNAME || '_chan', 'D' || OLD.id); RETURN OLD;
                                        END IF;
                                    END; $$ LANGUAGE plpgsql SECURITY DEFINER;`
        //自动为用户创建触发器函数
        await client.query(create_trigger_func)
        return false
    }else{
        // 如果查到记录，返回true
        return true
    }
}

/**
 * 用于检查触发器是否存在的函数
 * @param { Client } client 
 * @param { string } table 缓存表名
 * @returns {Promise<boolean>} 返回一个boolean值
 */
async function checkTrigger(client,table){
    //查pg的pg_trigger表,检查每个表触发器是否存在
    const checkTriggerSql =`select * from pg_trigger where tgname=$1`
    const { rows }=await client.query(checkTriggerSql,[`t_${table}_notify`])
    if(rows.length===0){
        //如果检查到触发器不存在，那么就需要开发者手动创建触发器
        config.logger.warn(`t_${table}_notify触发器不存在,程序将为您自动创建触发器!`)
        //检查需要创建触发器的表是否在数据库中存在
        const tableExSql ='select count(*) from pg_class where relname=$1;'
        const { rows:exist } =await client.query(tableExSql,[table])
        //如果不存在，那么告诉用户需要先创建数据表
        if(exist[0].count==='0'){
            config.logger.warn(`触发器创建失败,表${table}还未创建，请先创建数据表！！！`)
        }else{
            //如果存在数据表那么就自动为用户创建对应数据表的触发器
            const trigger_sql = `CREATE TRIGGER t_${table}_notify AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE PROCEDURE notify_change();`
            await client.query(trigger_sql).then(()=>{
                client.query(`LISTEN ${table}_chan`)
                config.logger.info(`系统已经为您创建了新的触发器，并且开始监听此触发器t_${table}_notify`)
            }).catch(err=>{
                config.logger.error('在创建触发器时，系统发生了错误，错误信息:',err)
            })
        }
        return false
    }else{
        //检查到触发器存在,那么程序可以继续运行
        return true
    }
}


/**
 * 3.监听pg数据库,如果数据发生更改,载入缓存
 * @param { Client } client 
 * @param { object } cacheTable    载入缓存配置(因为并不知道哪个缓存表需要缓存)
 */
async function listening(client,cacheTable){
    client.on('notification', async msg => {
        try{
            config.logger.info('监听到有数据变动,监听信息:%o',msg)
            //监听到有数据变动，那么就把变动的数据保存到redis数据库
            const tableName =msg.channel.replace('_chan','')  //从变动中获取表的名字
            const chan_id = msg.payload.slice(1)  //从变动中获取到操作的主键id
            const chan_op  =msg.payload[0]    //从监听中获取到操作类型 ： U/I/D
            //匹配 监听到的数据表---配置文件中的缓存表 拿到对应的 需要缓存的配置 如 需要缓存的类型(value_type) 需要缓存的字段(value_field)等
            cacheTable.forEach(async item=>{
                if(tableName === item.table){
                    const configData =await checkCacheObj(item).catch(err=>{
                        //如果配置项不完整，记录错误日志
                        config.logger.error(err)
                    })
                    //把这些缓存配置和操作类型，操作id交给cacheUp函数
                    await cacheUp(client,chan_op,chan_id,configData)
                }
            })
        }catch(err){
            config.logger.error('监听pg数据库并在pg数据库中读取缓存数据时发生了错误，错误信息:',err)
        }
    })
}

/**
 * 把缓存从pg数据库中取出来，下一步放入redis(调用cacheLoad函数)
 * @param { Client } client 
 * @param { string} chan_op 
 * @param { string } chan_id 
 * @param { object } configData 
 */
async function cacheUp(client,chan_op,chan_id,configData){
    //获得对应的缓存配置
    const { table,expire,key_prefix,key_field,value_field,value_type }=configData
    if(chan_op==='I'||chan_op==='U'){
        //如果是插入或者更新操作，那么会来到这个分支
        config.logger.info('插入或者更新操作,更新的表名字是：%s，更新的主键id是:%s,操作的类型是%s',table,chan_id,value_type)
        //拼接字段，并去pg数据库中取得对应字段的数据
        let field =''
        if(key_field.length ===0){
            field = value_field.join(',')
        }else{
            field = key_field.join(',') + ',' + value_field.join(',')
        }
        const sql =`select ${field} from ${table} where id=$1` 
        await client.query(sql,[chan_id]).then(
            async result=>{
                //从pg数据库中获得数据 ，如果没有获得对应的缓存数据，以警告的方式写入日志，告诉用户没有找到缓存数据
                if(result.rows.length !==0 ){
                    const data =result.rows[0]
                    config.logger.info("需要缓存的数据:",data)
                    await cacheLoad(chan_op,chan_id,configData,data)
                }else{
                    config.logger.warn("在pg中没有找到缓存数据,缓存失败")
                }
            }
        ).catch(e =>  config.logger.error('在pg中查询需要缓存的数据的时候出现错误,错误信息:',e.stack))
    }else if(chan_op==='D'){
        const data ={id:chan_id}
        config.logger.info(`正在删除一个redis缓存内容,操作id:${chan_id},redis类型${value_type}`)
        await cacheLoad(chan_op,chan_id,configData,data)
    }
}

/**
 * 把从pg数据库中取出来的缓存数据，根据不同的操作类型放到redis里面去
 * @param { string } chan_op 
 * @param { string } chan_id 
 * @param { object } configData 
 * @param { object } data 
 */
async function cacheLoad(chan_op,chan_id,configData,data){
    try{
        const { key_field,key_prefix,value_type,value_field,expire } =configData
        //连接redis
        const Rclient = await config.ioredis()

        //如果是插入或者更新pg数据库中数据
        if(chan_op ==='I'||chan_op ==='U'){
            //拼接在redis中需要存入的键
            let key =key_prefix
            if(key_field.length !== 0){
                for(let key_suffix of key_field){
                    key += ':'+ data[key_suffix]
                }
            }
            if(value_type==="hash"){
                let cacheData = {}
                for(let val of value_field){
                    cacheData[val] = data[val]
                }
                //@ts-ignore
                await Rclient.hmset(key,cacheData);
                if(expire !== -1){
                    await Rclient.expire(key,expire)
                }
            }else if(value_type==="string"){
                let cacheData = []
                for(let val of value_field){
                    cacheData.push(data[val])
                }
                let cacheString = cacheData.join(',')
                await Rclient.set(key,cacheString)
                if(expire !== -1){
                    await Rclient.expire(key,expire)
                }
            }else if(value_type==="set"){
                if(Object.values(data).length > 0){
                    let cacheData = []
                    for(let val of value_field){
                        cacheData.push(data[val])
                    }
                    let cacheString = cacheData.join(',')
                    await Rclient.sadd(key,cacheString)
                    if(expire !== -1){
                        await Rclient.expire(key,expire)
                    }
                }else{
                    config.logger.warn('操作数据不存在，无法插入到redis中')
                    return;
                }
            }else if(value_type==="list"){
                //对于list类型 后续如果需要在这个分支下补充
                config.logger.warn('list类型的还未支持，后续需要再补充')
            }
        }else if(chan_op ==='D'){
            //执行了删除操作 ，直接找到对应id的数据 在redis里面删除
            let key =key_prefix
            if(key_field.length >1){
                config.logger.info(`key_field中存在多个值,只能等缓存过期`)
            }else if(key_field.indexOf('id') !== -1){
                key = key_prefix +':'+chan_id
            }else if(key_field.length ===1){
                config.logger.info(`key_field中的值不为id,只能等缓存过期`)
            }
            //注意:如果是set类型 那么会把key中的其他value也删除，这时候需要重新缓存
            if(await Rclient.exists(key)>0){
                config.logger.info(`删除redis缓存数据对应的key为:${key}`)
                await Rclient.del(key);
            }
        }else{
            //操作类型既不是I也不是U也不是 D
            config.logger.warn("操作类型是无法识别(I/U/D)的类型")
            return;
        }
    }catch(err){
        config.logger.error("操作redis进行缓存发生了错误,错误信息:",err)
    }



}



/**
 * 程序运行的主函数
 */
async function main(){


    //检查配置文件
    const cacheTable =config.checkConfigFile()

    //建立pg数据库连接
    const client =await config.pg()

    //检查触发器函数是否存在,如果不存在自动创建触发器
    const result =await checkTriggerFunc(client)
    if(result === false){
        config.logger.warn('触发器函数不存在,已经为您自动创建监听器函数notify_change······')
    }


    for(var obj of cacheTable){
        //1.检查缓存表的各个配置项是否存在
        const val =await checkCacheObj(obj).catch(err=>{
            //如果配置项不完整，记录错误日志
            config.logger.error(err)
        })
        //2.对每个表检查触发器是否存在
        const { table } = val
        const result =await checkTrigger(client,table)
        if(result===true){
            //触发器已经创建好了，那么就监听触发器
            config.logger.info(`监听触发器t_${table}_notify`)
            await client.query(`LISTEN ${table}_chan`)
        }
    }

    //监听触发器，获得监听信息
    await listening(client,cacheTable)

}

//程序从这里开始运行
( async () => {
    try {
        main();
    } catch (error) {
        config.logger.error('程序发生了错误，错误信息:',error)
    }
})();