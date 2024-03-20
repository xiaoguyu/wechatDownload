DROP TABLE IF EXISTS wx_article;
CREATE TABLE wx_article (
    id INT ( 11 ) NOT NULL AUTO_INCREMENT,
    title VARCHAR ( 255 ) NULL DEFAULT NULL COMMENT '标题',
    content LONGTEXT NULL COMMENT '内容',
    author VARCHAR ( 255 ) NULL DEFAULT NULL COMMENT '作者',
    content_url VARCHAR ( 1023 ) NULL DEFAULT NULL COMMENT '详情链接',
    create_time datetime ( 0 ) NULL DEFAULT NULL,
    copyright_stat INT ( 11 ) NULL DEFAULT NULL,
    PRIMARY KEY ( id ) USING BTREE,
    UNIQUE INDEX uni_title ( title, create_time ) USING BTREE 
) ;

-- 2023-4-1 添加评论字段
ALTER TABLE wx_article ADD COLUMN comm LONGTEXT NULL COMMENT '精选评论',
ADD COLUMN comm_reply LONGTEXT NULL COMMENT '评论回复';

-- 2024-3-19
ALTER TABLE wx_article ADD COLUMN digest VARCHAR(1023) NULL COMMENT '摘要',
ADD COLUMN cover  VARCHAR(511) NULL COMMENT '封面',
ADD COLUMN js_name VARCHAR ( 255 ) NULL COMMENT '公众号',
ADD COLUMN md_content LONGTEXT NULL COMMENT 'markdown内容';