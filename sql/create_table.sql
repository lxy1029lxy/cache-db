CREATE TABLE IF NOT EXISTS "users"(
    id text not null default '',
    name text not null default '',
    age int not null default 20,
    create_time timestamp with time zone not null default current_timestamp,
    steate text not null default 'enable',
    CONSTRAINT pk_users PRIMARY KEY ( id )
);

CREATE TABLE IF NOT EXISTS 'tb_test1'(
    id text not null default '',
    ids text[] not null default '{}',
    CONSTRAINT pk_tb_test1 PRIMARY KEY ( id )
);

CREATE TABLE IF NOT EXISTS "activity_staff"(
    id text not null default '',
    activity_id text not null default '',
    staff_id text not null default '',
    CONSTRAINT pk_activity_staff PRIMARY KEY ( id )
);
