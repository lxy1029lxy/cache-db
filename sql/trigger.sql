-- 为用户表创建行级触发器，监听INSERT UPDATE DELETE 操作。
-- 示例
CREATE TRIGGER t_user_notify AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE PROCEDURE notify_change();