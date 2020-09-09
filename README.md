# 需求:利用postgres监听器实现postgres-redis缓存同步

## 用到的模块:  

    1. fs (用于检查配置文件是否存在)
    2. pg (连接postgres数据库，利用监听器 监听到的数据实现缓存同步)
    3. ioredis (将缓存数据保存到redis中)
    4. log4js (用于保存日志)

## 目录结构:  



        yz-pg-redis-sync    
              ├── package.json
              ├── package-lock.json
              ├── sql
              ├——  ├—— create_table.sql  (创建数据库的语句)
              ├——  ├—— trigger.sql       (触发器创建语句  主要是用于测试)
              ├——  ├—— trigger_func.sql  (触发器函数创建语句 ， 开发者需要原封不动的创建这个触发器函数(开发基于这个触发器函数))
              ├── index.js               (主函数和主要逻辑保存在这个文件)
              ├── config.js		         (配置了一些函数，用于检查环境变量和数据库(postgres,redis)连接)
              ├── cecheTable.json		 (保存需要缓存的表的配置文件)
              ├── node_modules			 (导入的模块)
              ├── start.sh 			     程序的入口 在bash下输入 ./start.sh 即可运行程序

## 配置文件(cecheTable.json)说明: 

			1.配置文件是一个json文件。所有需要缓存的表都以对象的形式保存在一个列表里面。		
				例:        [
				                {
				                    "table": "activity_staff",
				                    "expire":-1,
				                    "key_prefix": "activity_staff",
				                    "key_field": [ "activity_id" ] ,
				                    "value_field":[ "staff_id" ] ,
				                    "value_type": "set"
				                },
				                {
				                    "table": "users",
				                    "key_prefix": "user",
				                    "value_field":[ "id" ] ,
				                    "value_type": "set"
				                }
				           ]
			2.缓存表包含上述这些字段，其中"table","key_prefix","value_field",和"value_type"是必填的
			"expire"和"key_field"是选填的, "key_field"默认[],expire在key_field为[]或者为["id"]时默认为-1，
			在其他情况默认为6个小时(因为其他情况无法删除缓存数据。必须设置缓存时间).
			
			3.对每个字段的介绍如下:
	
				table(string)           
				代表需要存到redis缓存中对应pg数据库中的表名,要求必须和pg数据库中的表名一致,不然程序在操作触发器的时候会出现问题!
	
				expire(number)          
				代表数据在redis中的缓存时间(单位是秒)，如果不写,在key_field为[]或者为["id"]时默认为-1，
				在其他情况默认为6个小时(因为其他情况无法删除缓存数据。必须设置缓存时间).
	
				key_prefix(string)      
				对应redis中缓存数据的key的前缀 和 key_field字段拼接在一起构成redis中的key
	
				key_field (Array)       
				对应在redis中缓存数据的key的后半部分 并且是一个列表的形式,
				以key_prefix : key_field.join(":")的形式构成键.
				例如 查找一个id为22,age为15 的用户(user) 他的key_prefix 为 user ，他的key_field可以为["id,age"]
				那么 这个数据在redis中的key为 user:22:15   (对应key_prefix:key_field1:key_field2)
				当key_filed不为id或者空列表的时候最好把缓存时间(expire)写上，
				不然程序会警告，并且自动将缓存时间设置为6个小时.
	
				value_field(Array)      
				对应在redis缓存中的value,如果需要缓存的value_type是hash，
				那么会以一个对象的形式保存数据,其中value_field代表对象的键,数据是对应的值
				如果保存的value_type是set或者string，保存的value_filed的长度如果大于1，
				那么保存时会将value_field用","拼接
	
				value_type(string)      
				对应数据保存在redis中的数据类型,目前只支持 hash、set和string。


## 缓存说明:  

			1.如果是增加/更新(I/U)了postgres数据库，
			实际上是根据不同的类型往redis中写入了一条数据(如果是更新那么redis会覆盖原来的那条数据)
	
			2.如果是删除,那么程序会根据使用者输入的数据的对应id 找到对应的那条redis数据 然后将其删除。
			对于hash、string数据类型来说 只是删除了对应数据的那条redis缓存
			但是对于set类型来说 他会把集合中的所有数据都删除(因为只是按照key删除，set中可能有多个value)
	
			3.如果对于同一个数据表需要缓存两种类型(最多只能缓存两种类型)的redis数据，也可以做到.
			例如 对users表要在redis中要缓存 set 和 hash 两条数据 那么设置格式如下
			(注意！！！在任何情况下，不管是相同表还是不同表在redis中的key都不能相同):
				[
				    {
				        "table": "users",
				        "expire":30,
				        "key_prefix": "user",
				        "key_field": [ "id" ] ,
				        "value_field":[ "name","age"  ] ,
				        "value_type": "hash"
				    },
				    {
				        "table": "users",
				        "expire":-1,
				        "key_prefix": "user_name",
					    "key_field":["name"],
				        "value_field":[ "id" ] ,
				        "value_type": "string"
				    }
				]

## 操作流程([可以参考这篇文章](http://vonng.com/blog/pg-notify-sync/ ))



	1.配置程序所需要的用到的环境,在启动时导入环境变量(即配置start.sh文件)
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
					
			#配置文件的路径
			export CONFIG_FILE_PATH=./cacheTable.json
	
			#设置的缓存时间(-1代表缓存时间为永久)
			export CACHE_TIME = -1
	
			#程序启动命令
			node index.js
			
	2.需要在postgres中的对需要缓存的数据库 创建一个监听器函数 用于监听开发者的增删改（I/D/U）操作(如果没有创建，那么在运行程序后,程序会自动创建)监听器函数创建如下(基本不需要改动):
				`CREATE OR REPLACE FUNCTION notify_change() RETURNS TRIGGER AS $$
								BEGIN
									IF    (TG_OP = 'INSERT') THEN 
									PERFORM pg_notify(TG_RELNAME || '_chan', 'I' || NEW.id); RETURN NEW;
									ELSIF (TG_OP = 'UPDATE') THEN 
									PERFORM pg_notify(TG_RELNAME || '_chan', 'U' || NEW.id); RETURN NEW;
									ELSIF (TG_OP = 'DELETE') THEN 
									PERFORM pg_notify(TG_RELNAME || '_chan', 'D' || OLD.id); RETURN OLD;
									END IF;
								END; $$ LANGUAGE plpgsql SECURITY DEFINER;`
									
	3.对需要缓存的数据表(每一个需要缓存的表都需要) 需要创建监听器(${table}代表对应的表名):
			  `CREATE TRIGGER t_${table}_notify AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE PROCEDURE notify_change();`
				
	4.运行 ./start.sh 启动程序(如果表对应的监听器不存在,那么程序会自动创建触发器,如果对应的表不存在,那么监听器会创建失败！程序虽然不会停止但是对应表的数据将无法保存到redis中)
			
	5.在运行了这个程序以后，实际上程序监听了postgres数据库 只要发生了增删改那么就会把对应的数据缓存到redis中(当然前提是对应的数据表在配置文件中存在)


​			
## 开发说明:
	程序是从start.sh开始运行 (实际上是在导入了环境变量以后,利用node运行了index.js文件) 程序包含的函数有以下:
	index.js中:
	
	1.main              
		主函数，程序实际上从这里开始
						
	2.checkTriggerFunc  
		检查触发器函数,参数： postgres.client （数据库连接）检查的过程实际上是去postgres数据库中根据触发器函数('notify_change')查pg_proc表，这是postgres用于保存函数的表
				
	3.checkTrigger      
		检查数据表对应的触发器是否存在,接收的参数是：postgres.client和 tableName ---需要缓存的表名(以循环的方式从cacheTable中获得)
				
	4.listening         
		用于监听触发器，当发生了I/U/D事件，那么监听到数据发生更改,并且把数据交给cacheUp函数
	
	5.cacheUp           
		根据监听到的操作(I/U/D)，去postgres数据库中取出对应的data，把data交给cacheLoad函数
			
	6.cacheLoad	        
		根据配置文件中的value_type不同,将不同数据类型的数据用不同的方式保存到redis中，如果数据类型不正确，那么会把失败信息保存在日志文件中并且告诉用户缓存保存失败
					
	config.js中:
	
	1.checkEnv          
		用于检查环境变量，如果环境变量不存在，那么抛出一个异常，提醒使用者设置环境变量
					
	2.checkConfigFile   
		检查配置文件路径是否正确，如果在配置文件路径中找不到配置文件，那么抛出一个异常，提醒使用者修改环境变量
	
	3.checkCacheObj     
		检查配置文件中的配置项是否完整,如果选填项没有填写给它默认值,如果必填项没有填写,抛出异常,并且写入日志.
	
	4.pg                
		连接pg数据库
					
	5.ioredis           
		连接redis数据库
	
	6.logger            
		记录日志