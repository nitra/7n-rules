<?php

declare(strict_types=1);

function findUser(mysqli $db, string $name): mysqli_result|false
{
    $id = $_GET['id'];
    $query = 'SELECT * FROM users WHERE id = ' . $id . " AND name = '" . $name . "'";
    return $db->query($query);
}
